// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HederaHarness} from "hedera-harness/HederaHarness.sol";
import {MockHSS} from "hedera-harness/mocks/MockHSS.sol";
import {BondRegistry} from "../src/BondRegistry.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {BondMarket} from "../src/BondMarket.sol";
import {BondLifecycle} from "../src/BondLifecycle.sol";
import {RiskGate} from "../src/RiskGate.sol";
import {IATSBond} from "../src/interfaces/IATSBond.sol";

/// @notice The demo storyline against a live deployment (`deployments/testnet.json`), one entrypoint per beat:
///           runApprovals  runIssuerSell  runRejectedBuy  runKycBuy  runCollateral  runCoupon
///           runFreeze  runUnfreeze  runRedeemPreview  runStatus
/// @dev Run each as (the `FS` of docs/DEMO.md)
///        forge script contracts/script/Demo.s.sol:Demo --sig "runKycBuy()" --rpc-url hedera --broadcast --legacy --slow
///      Add `--skip-simulation` only to runCoupon when the scheduled run has not fired and it must call `payCoupon`
///      by hand: that path reaches the Schedule Service (0x16b, no code in forge's EVM; MockHSS is etched for the
///      local run only), so forge's on-chain simulation would reject the tx. Every other beat is fine without it.
///      Read-only beats (runRejectedBuy, runRedeemPreview, runStatus) need no --broadcast. Views printed by a
///      broadcasting beat are forge's local post-tx state; runStatus reads the chain.
///      Env: HEDERA_PRIVATE_KEY (issuer/admin/relayer), INVESTOR1_KEY, INVESTOR3_KEY, RISK_SIGNER_KEY,
///           DEPLOYMENTS_FILE (deployments/testnet.json), ORDER_ID (defaults to the issuer's live sell order).
contract Demo is Script {
    uint128 internal constant PX = 990_000; // 0.99 USDC per bond
    uint256 internal constant HUNDRED_USDC = 100e6;

    BondRegistry internal registry;
    CollateralVault internal vault;
    BondMarket internal market;
    BondLifecycle internal lifecycle;
    RiskGate internal riskGate;
    IATSBond internal token;
    IERC20 internal usdc;
    uint256 internal bondId;
    uint256 internal issuerKey;
    address internal issuer;

    error NoSellOrder();
    error WrongSigner(address key, address expected);

    function setUp() public {
        string memory j = vm.readFile(vm.envOr("DEPLOYMENTS_FILE", string("deployments/testnet.json")));
        registry = BondRegistry(vm.parseJsonAddress(j, ".registry"));
        vault = CollateralVault(payable(vm.parseJsonAddress(j, ".vault")));
        market = BondMarket(vm.parseJsonAddress(j, ".market"));
        lifecycle = BondLifecycle(payable(vm.parseJsonAddress(j, ".lifecycle")));
        riskGate = RiskGate(vm.parseJsonAddress(j, ".riskGate"));
        token = IATSBond(vm.parseJsonAddress(j, ".token"));
        usdc = IERC20(vm.parseJsonAddress(j, ".settlement"));
        bondId = vm.parseJsonUint(j, ".bondId");
        issuerKey = vm.envUint("HEDERA_PRIVATE_KEY");
        issuer = vm.addr(issuerKey);
        vm.etch(address(HederaHarness.HSS), type(MockHSS).runtimeCode); // local run only
    }

    /// @notice Issuer: bond -> market, USDC -> lifecycle. inv1: USDC + bond -> market. inv3: USDC -> market.
    function runApprovals() external {
        vm.startBroadcast(issuerKey);
        token.approve(address(market), type(uint256).max);
        usdc.approve(address(lifecycle), type(uint256).max);
        vm.stopBroadcast();

        vm.startBroadcast(vm.envUint("INVESTOR1_KEY"));
        usdc.approve(address(market), type(uint256).max);
        token.approve(address(market), type(uint256).max);
        vm.stopBroadcast();

        vm.startBroadcast(vm.envUint("INVESTOR3_KEY"));
        usdc.approve(address(market), type(uint256).max);
        vm.stopBroadcast();
        console.log("approvals done");
    }

    /// @notice Issuer asks 20 bonds @ 0.99 USDC, good for 7 days.
    function runIssuerSell() external {
        vm.startBroadcast(issuerKey);
        uint256 id = market.place(bondId, true, 20, PX, uint64(block.timestamp + 7 days));
        vm.stopBroadcast();
        console.log("sell order %s: 20 @ %s (export ORDER_ID=%s)", id, PX, id);
    }

    /// @notice inv3 (no KYC): the ATS pre-check and the fill itself both reject with 0x10 / InvalidKycStatus.
    ///         Simulated locally against chain state (no gas, no abort); the cast commands reproduce it live.
    function runRejectedBuy() external {
        address inv3 = vm.addr(vm.envUint("INVESTOR3_KEY"));
        uint256 id = _sellOrder();

        vm.prank(address(market));
        (bool ok, bytes1 code, bytes32 reason) = token.canTransferFrom(issuer, inv3, 10, "");
        console.log("canTransferFrom(issuer -> inv3, 10): ok=%s code=%s", ok, vm.toString(abi.encodePacked(code)));
        console.log("  reason selector: %s", vm.toString(abi.encodePacked(bytes4(reason))));

        vm.prank(inv3);
        (bool success, bytes memory ret) = address(market).call(abi.encodeCall(market.fill, (id, 10)));
        if (success) {
            console.log("UNEXPECTED: fill by inv3 succeeded");
            return;
        }
        bytes4 sel = bytes4(ret);
        console.log("fill(%s, 10) by inv3 reverted with %s", id, vm.toString(abi.encodePacked(sel)));
        if (sel == BondMarket.ComplianceRejected.selector) {
            (bytes1 c, bytes32 r) = abi.decode(_args(ret), (bytes1, bytes32));
            console.log(
                "  ComplianceRejected(code %s, reason %s)",
                vm.toString(abi.encodePacked(c)),
                vm.toString(abi.encodePacked(bytes4(r)))
            );
        }
        console.log("live:  cast call %s 'fill(uint256,uint128)' %s 10 --from %s --rpc-url hedera", address(market), id, inv3);
        console.log(
            "on-chain evidence (lands as a reverted tx): cast send %s 'fill(uint256,uint128)' %s 10 --private-key $INVESTOR3_KEY --gas-limit 300000 --rpc-url hedera",
            address(market),
            id
        );
    }

    /// @notice inv1 (KYC'd) takes 10 of the issuer's ask.
    function runKycBuy() external {
        uint256 id = _sellOrder();
        uint256 pk = vm.envUint("INVESTOR1_KEY");
        vm.startBroadcast(pk);
        market.fill(id, 10);
        vm.stopBroadcast();
        console.log("inv1 filled 10 of order %s; bond balance now %s", id, token.balanceOf(vm.addr(pk)));
    }

    /// @notice Issuer posts 100 HBAR of collateral (100 ether through the relay = 1e10 tinybar on chain).
    function runCollateral() external {
        vm.startBroadcast(issuerKey);
        vault.deposit{value: 100 ether}(bondId);
        vm.stopBroadcast();
        console.log("deposited 100 HBAR; run runStatus() for the on-chain coverageBps");
    }

    /// @notice Fund 100 USDC; pay the coupon by hand if it is due and the scheduled run has not fired; claim.
    function runCoupon() external {
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        vm.startBroadcast(issuerKey);
        lifecycle.fund(bondId, HUNDRED_USDC);
        if (block.timestamp >= t.nextCoupon && t.nextCoupon <= t.maturity) {
            console.log("coupon due at %s and not paid: paying by hand", t.nextCoupon);
            lifecycle.payCoupon(bondId);
        }
        uint256 n = lifecycle.couponCount(bondId);
        if (n > 0 && lifecycle.claimable(bondId, n, issuer) > 0) lifecycle.claim(bondId, n);
        vm.stopBroadcast();
        if (n == 0) {
            console.log("no coupon yet: next due %s, now %s", t.nextCoupon, block.timestamp);
            return;
        }
        (, uint256 amount,,) = lifecycle.coupons(bondId, n);
        console.log("coupon %s: %s settlement units; issuer claimed", n, amount);
        uint256 pk = vm.envUint("INVESTOR1_KEY");
        uint256 share = lifecycle.claimable(bondId, n, vm.addr(pk));
        if (share == 0) return;
        vm.startBroadcast(pk);
        lifecycle.claim(bondId, n);
        vm.stopBroadcast();
        console.log("inv1 claimed %s", share);
    }

    /// @notice Sign a FREEZE verdict with the risk signer key (what the CRE enclave does) and relay it.
    function runFreeze() external {
        uint256 sk = vm.envUint("RISK_SIGNER_KEY");
        address expected = riskGate.signer();
        if (vm.addr(sk) != expected) revert WrongSigner(vm.addr(sk), expected);
        RiskGate.Snapshot memory s = riskGate.snapshot(bondId);
        RiskGate.Verdict memory v = RiskGate.Verdict({
            bondId: bondId,
            action: uint8(RiskGate.Action.FREEZE),
            coverageObserved: s.coverageBps,
            issuedAt: uint64(block.timestamp),
            nonce: s.lastNonce + 1
        });
        (uint8 v8, bytes32 r, bytes32 s_) = vm.sign(sk, riskGate.hashVerdict(v));
        vm.startBroadcast(issuerKey);
        riskGate.submit(v, abi.encodePacked(r, s_, v8));
        vm.stopBroadcast();
        console.log("FREEZE nonce %s applied; status now %s (2 = Frozen)", v.nonce, uint8(registry.status(bondId)));
    }

    function runUnfreeze() external {
        vm.startBroadcast(issuerKey);
        riskGate.unfreeze(bondId);
        vm.stopBroadcast();
        console.log("unfrozen; status now %s (1 = Active)", uint8(registry.status(bondId)));
    }

    /// @notice What redeem() would need for the issuer and inv1 (read-only).
    function runRedeemPreview() external view {
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        address inv1 = vm.addr(vm.envUint("INVESTOR1_KEY"));
        uint256 need = token.totalSupply() * t.faceValue / 10 ** t.bondDecimals;
        console.log("maturity %s, now %s, matured: %s", t.maturity, block.timestamp, block.timestamp >= t.maturity);
        console.log("principal for all %s bonds: %s; funded: %s", token.totalSupply(), need, lifecycle.funded(bondId));
        console.log("issuer holds %s -> %s", token.balanceOf(issuer), token.balanceOf(issuer) * t.faceValue / 10 ** t.bondDecimals);
        console.log("inv1 holds %s -> %s", token.balanceOf(inv1), token.balanceOf(inv1) * t.faceValue / 10 ** t.bondDecimals);
        console.log("status %s (3 = Matured, 4 = Defaulted: redeem reverts)", uint8(t.status));
    }

    /// @notice On-chain state in one read: status, collateral (with the tinybar check), coverage, coupons, book.
    function runStatus() external view {
        RiskGate.Snapshot memory s = riskGate.snapshot(bondId);
        console.log("status %s | feedFresh %s | coverageBps %s", s.status, s.feedFresh, s.coverageBps);
        console.log("collateral raw %s = %s HBAR if tinybar (Hedera) / %s HBAR if 18-dec (anvil)", s.collateral, s.collateral / 1e8, s.collateral / 1e18);
        console.log("mark %s | nextCoupon %s | maturity %s", s.mark, s.nextCoupon, s.maturity);
        console.log("lastNonce %s | lastAction %s", s.lastNonce, s.lastAction);
        console.log("funded %s | couponCount %s", lifecycle.funded(bondId), lifecycle.couponCount(bondId));
        console.log("schedule %s for %s | lifecycle HBAR float raw %s", lifecycle.scheduleOf(bondId), lifecycle.scheduledFor(bondId), address(lifecycle).balance);
        (uint128 bid, uint128 ask) = market.quote(bondId);
        console.log("book: bid %s ask %s", bid, ask);
    }

    // ------------------------------------------------------------------ helpers

    /// @dev ORDER_ID, else the first live sell order of the bond.
    function _sellOrder() internal view returns (uint256) {
        uint256 id = vm.envOr("ORDER_ID", uint256(0));
        if (id != 0) return id;
        uint256 end = market.nextOrderId();
        for (id = 1; id < end; ++id) {
            (uint256 b, address maker, bool isSell,,, uint64 expiry) = market.orders(id);
            if (maker != address(0) && b == bondId && isSell && (expiry == 0 || expiry > block.timestamp)) return id;
        }
        revert NoSellOrder();
    }

    /// @dev Revert data minus the 4-byte selector.
    function _args(bytes memory ret) internal pure returns (bytes memory out) {
        out = new bytes(ret.length - 4);
        for (uint256 i; i < out.length; ++i) {
            out[i] = ret[i + 4];
        }
    }
}
