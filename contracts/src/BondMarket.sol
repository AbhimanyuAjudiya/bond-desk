// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BondRegistry} from "./BondRegistry.sol";
import {RegistryAuth} from "./RegistryAuth.sol";
import {NavOracle} from "./NavOracle.sol";
import {IATSBond} from "./interfaces/IATSBond.sol";

/// @notice Limit-order book for registered bonds. Every fill is pre-checked against ATS compliance
///         (`canTransferFrom`) and settled atomically: settlement token buyer->seller (+fee), bond seller->buyer.
contract BondMarket is RegistryAuth, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Order {
        uint256 bondId;
        address maker;
        bool isSell;
        uint128 amount;
        uint128 price; // settlement units per whole bond token
        uint64 expiry; // 0 = good till cancelled
    }

    NavOracle public immutable oracle;
    uint256 public nextOrderId = 1;
    mapping(uint256 => Order) public orders;
    mapping(uint256 => uint16) public bandBps; // 0 = no band check
    address public treasury;
    uint16 public feeBps;
    uint16 public constant MAX_FEE_BPS = 100;

    event OrderPlaced(
        uint256 indexed orderId,
        uint256 indexed bondId,
        address indexed maker,
        bool isSell,
        uint128 amount,
        uint128 price,
        uint64 expiry
    );
    event OrderCancelled(uint256 indexed orderId);
    event Filled(
        uint256 indexed bondId,
        uint256 indexed orderId,
        address maker,
        address taker,
        uint128 amount,
        uint128 price,
        uint256 cost,
        uint256 fee
    );
    event BandSet(uint256 indexed bondId, uint16 bps);
    event FeeSet(address treasury, uint16 bps);

    error BondNotActive(uint256 bondId, BondRegistry.Status s);
    error OrderNotFound(uint256 orderId);
    error OrderExpired(uint256 orderId);
    error NotMaker();
    error BadAmount();
    error BadPrice();
    error BadExpiry();
    error ComplianceRejected(bytes1 code, bytes32 reason);
    error PriceOutOfBand(uint256 price, uint256 mark, uint16 bandBps);
    error FeeTooHigh();
    error BondTransferFailed();

    constructor(BondRegistry registry_, NavOracle oracle_, address treasury_, uint16 feeBps_) RegistryAuth(registry_) {
        oracle = oracle_;
        _setFee(treasury_, feeBps_);
    }

    /// @notice Place a limit order on an Active bond. Balances / allowances are not checked until fill.
    function place(uint256 bondId, bool isSell, uint128 amount, uint128 price, uint64 expiry)
        external
        returns (uint256 orderId)
    {
        BondRegistry.Status s = registry.status(bondId);
        if (s != BondRegistry.Status.Active) revert BondNotActive(bondId, s);
        if (amount == 0) revert BadAmount();
        if (price == 0) revert BadPrice();
        if (expiry != 0 && expiry <= block.timestamp) revert BadExpiry();
        orderId = nextOrderId++;
        orders[orderId] = Order(bondId, msg.sender, isSell, amount, price, expiry);
        emit OrderPlaced(orderId, bondId, msg.sender, isSell, amount, price, expiry);
    }

    function cancel(uint256 orderId) external {
        address maker = orders[orderId].maker;
        if (maker == address(0)) revert OrderNotFound(orderId);
        if (maker != msg.sender) revert NotMaker();
        delete orders[orderId];
        emit OrderCancelled(orderId);
    }

    /// @notice Take `amount` of an order. Fee is charged to the buyer on top of the seller's proceeds.
    function fill(uint256 orderId, uint128 amount) external nonReentrant {
        Order memory o = orders[orderId];
        if (o.maker == address(0)) revert OrderNotFound(orderId);
        if (o.expiry != 0 && o.expiry <= block.timestamp) revert OrderExpired(orderId);
        if (amount == 0 || amount > o.amount) revert BadAmount();

        BondRegistry.BondTerms memory t = registry.terms(o.bondId);
        if (t.status != BondRegistry.Status.Active) revert BondNotActive(o.bondId, t.status);

        (address seller, address buyer) = o.isSell ? (o.maker, msg.sender) : (msg.sender, o.maker);
        _checkCompliance(t.token, seller, buyer, amount);
        _checkBand(o.bondId, o.price);

        uint256 c = cost(amount, o.price, t.bondDecimals);
        if (c == 0) revert BadAmount();
        uint256 fee = c * feeBps / 10_000;

        if (o.amount == amount) delete orders[orderId];
        else orders[orderId].amount = o.amount - amount;

        IERC20(t.settlement).safeTransferFrom(buyer, seller, c);
        if (fee != 0) IERC20(t.settlement).safeTransferFrom(buyer, treasury, fee);
        if (!IATSBond(t.token).transferFrom(seller, buyer, amount)) revert BondTransferFailed();

        emit Filled(o.bondId, orderId, o.maker, msg.sender, amount, o.price, c, fee);
    }

    /// @dev ATS compliance pre-check; surfaces the EIP-1066 code + reason instead of an opaque transferFrom revert.
    function _checkCompliance(address token, address seller, address buyer, uint128 amount) internal view {
        (bool ok, bytes1 code, bytes32 reason) = IATSBond(token).canTransferFrom(seller, buyer, amount, "");
        if (!ok) revert ComplianceRejected(code, reason);
    }

    /// @dev |price - mark| must be within bandBps of the oracle mark when a band is set for the bond.
    function _checkBand(uint256 bondId, uint128 price) internal view {
        uint16 band = bandBps[bondId];
        if (band == 0) return;
        uint256 mark = oracle.mark(bondId);
        uint256 diff = price > mark ? price - mark : mark - price;
        if (diff * 10_000 > mark * band) revert PriceOutOfBand(price, mark, band);
    }

    /// @notice Best bid / ask among live, unexpired orders of `bondId` (0 when that side is empty).
    // ponytail: linear scan over every order ever placed; index per bond if the book grows
    function quote(uint256 bondId) external view returns (uint128 bestBid, uint128 bestAsk) {
        uint256 end = nextOrderId;
        for (uint256 id = 1; id < end; ++id) {
            Order storage o = orders[id];
            if (o.maker == address(0) || o.bondId != bondId) continue;
            if (o.expiry != 0 && o.expiry <= block.timestamp) continue;
            if (o.isSell) {
                if (bestAsk == 0 || o.price < bestAsk) bestAsk = o.price;
            } else if (o.price > bestBid) {
                bestBid = o.price;
            }
        }
    }

    /// @notice Settlement owed for `amount` bond units at `price` per whole token (floored).
    function cost(uint128 amount, uint128 price, uint8 bondDecimals) public pure returns (uint256) {
        return uint256(amount) * uint256(price) / 10 ** bondDecimals;
    }

    function setBand(uint256 bondId, uint16 bps) external onlyAdmin {
        bandBps[bondId] = bps;
        emit BandSet(bondId, bps);
    }

    function setFee(address treasury_, uint16 feeBps_) external onlyAdmin {
        _setFee(treasury_, feeBps_);
    }

    function _setFee(address treasury_, uint16 feeBps_) internal {
        // a nonzero fee with no treasury would make every fill revert at the fee transfer
        if (feeBps_ > MAX_FEE_BPS || (feeBps_ != 0 && treasury_ == address(0))) revert FeeTooHigh();
        treasury = treasury_;
        feeBps = feeBps_;
        emit FeeSet(treasury_, feeBps_);
    }
}
