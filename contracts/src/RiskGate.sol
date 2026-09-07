// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BondRegistry} from "./BondRegistry.sol";
import {RegistryAuth} from "./RegistryAuth.sol";
import {NavOracle} from "./NavOracle.sol";
import {CollateralVault} from "./CollateralVault.sol";

/// @notice Lands EIP-712 risk verdicts signed inside the CRE enclave: FREEZE halts trading, DEFAULT seizes collateral.
///         Anyone may relay a verdict; the signature, per-bond nonce and freshness window are what is trusted.
/// @dev Needs GATE_ROLE on the registry (setStatus + vault.seize).
contract RiskGate is RegistryAuth, EIP712 {
    enum Action {
        OK,
        WARN,
        FREEZE,
        DEFAULT
    }

    struct Verdict {
        uint256 bondId;
        uint8 action;
        uint256 coverageObserved;
        uint64 issuedAt;
        uint64 nonce;
    }

    /// @dev Single-call read for the enclave (one eth_call per run).
    struct Snapshot {
        uint256 coverageBps;
        bool feedFresh;
        uint8 status;
        uint256 mark;
        uint256 collateral;
        uint64 lastNonce;
        uint8 lastAction;
        uint64 nextCoupon;
        uint64 maturity;
        uint64 timestamp;
    }

    bytes32 public constant VERDICT_TYPEHASH =
        keccak256("Verdict(uint256 bondId,uint8 action,uint256 coverageObserved,uint64 issuedAt,uint64 nonce)");
    uint64 public constant MAX_FUTURE_SKEW = 300;

    CollateralVault public immutable vault;
    NavOracle public immutable oracle;
    address public signer;
    uint64 public freshness;

    mapping(uint256 => uint64) public lastNonce;
    mapping(uint256 => Verdict) public lastVerdict;

    event VerdictApplied(uint256 indexed bondId, uint8 action, uint256 coverageObserved, uint64 nonce, address relayer);
    event Unfrozen(uint256 indexed bondId);
    event SignerSet(address signer);
    event FreshnessSet(uint64 freshness);

    error BadSignature();
    error StaleNonce(uint64 got, uint64 last);
    error StaleVerdict(uint64 issuedAt, uint64 nowTs);
    error FutureVerdict(uint64 issuedAt, uint64 nowTs);
    error BadAction(uint8 action);
    error NotFrozen(BondRegistry.Status s);

    constructor(BondRegistry registry_, CollateralVault vault_, NavOracle oracle_, address signer_, uint64 freshness_)
        RegistryAuth(registry_)
        EIP712("BondDeskRiskGate", "1")
    {
        vault = vault_;
        oracle = oracle_;
        signer = signer_;
        freshness = freshness_;
    }

    /// @notice EIP-712 digest the enclave signs.
    function hashVerdict(Verdict calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(VERDICT_TYPEHASH, v.bondId, v.action, v.coverageObserved, v.issuedAt, v.nonce))
        );
    }

    /// @notice Apply a signed verdict. FREEZE: Active -> Frozen. DEFAULT: Active/Frozen -> seize + Defaulted.
    ///         OK/WARN are recorded only (a freeze is lifted by the admin, never automatically).
    function submit(Verdict calldata v, bytes calldata sig) external {
        if (v.action > uint8(Action.DEFAULT)) revert BadAction(v.action);
        // tryRecover: malformed / high-s sigs surface as BadSignature, not OZ's ECDSAInvalidSignature* errors
        (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(hashVerdict(v), sig);
        if (err != ECDSA.RecoverError.NoError || rec != signer) revert BadSignature();
        uint64 last = lastNonce[v.bondId];
        if (v.nonce <= last) revert StaleNonce(v.nonce, last);
        uint64 nowTs = uint64(block.timestamp);
        if (v.issuedAt > nowTs + MAX_FUTURE_SKEW) revert FutureVerdict(v.issuedAt, nowTs);
        if (v.issuedAt < nowTs && nowTs - v.issuedAt > freshness) revert StaleVerdict(v.issuedAt, nowTs);

        lastNonce[v.bondId] = v.nonce;
        lastVerdict[v.bondId] = v;

        BondRegistry.Status s = registry.status(v.bondId);
        if (v.action == uint8(Action.FREEZE)) {
            if (s == BondRegistry.Status.Active) registry.setStatus(v.bondId, BondRegistry.Status.Frozen);
        } else if (v.action == uint8(Action.DEFAULT)) {
            if (s == BondRegistry.Status.Active || s == BondRegistry.Status.Frozen) {
                vault.seize(v.bondId);
                registry.setStatus(v.bondId, BondRegistry.Status.Defaulted);
            }
        }
        emit VerdictApplied(v.bondId, v.action, v.coverageObserved, v.nonce, msg.sender);
    }

    function unfreeze(uint256 bondId) external onlyAdmin {
        BondRegistry.Status s = registry.status(bondId);
        if (s != BondRegistry.Status.Frozen) revert NotFrozen(s);
        registry.setStatus(bondId, BondRegistry.Status.Active);
        emit Unfrozen(bondId);
    }

    function setSigner(address signer_) external onlyAdmin {
        signer = signer_;
        emit SignerSet(signer_);
    }

    function setFreshness(uint64 freshness_) external onlyAdmin {
        freshness = freshness_;
        emit FreshnessSet(freshness_);
    }

    /// @notice Everything the risk monitor needs in one view; a stale feed yields feedFresh=false, coverageBps=0.
    function snapshot(uint256 bondId) external view returns (Snapshot memory s) {
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        try vault.coverageBps(bondId) returns (uint256 c) {
            s.coverageBps = c;
            s.feedFresh = true;
        } catch {}
        s.status = uint8(t.status);
        s.mark = oracle.mark(bondId);
        s.collateral = vault.collateral(bondId);
        s.lastNonce = lastNonce[bondId];
        s.lastAction = lastVerdict[bondId].action;
        s.nextCoupon = t.nextCoupon;
        s.maturity = t.maturity;
        s.timestamp = uint64(block.timestamp);
    }
}
