// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BondDeskTest} from "./Base.t.sol";
import {BondRegistry} from "../src/BondRegistry.sol";
import {RegistryAuth} from "../src/RegistryAuth.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {RiskGate} from "../src/RiskGate.sol";

contract RiskGateTest is BondDeskTest {
    CollateralVault internal vault;
    RiskGate internal riskGate;
    address internal gate = makeAddr("gate"); // plain GATE_ROLE holder to force statuses in tests
    uint256 internal constant HUNDRED = 100 * 1e8;
    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    uint8 internal constant OK = uint8(RiskGate.Action.OK);
    uint8 internal constant WARN = uint8(RiskGate.Action.WARN);
    uint8 internal constant FREEZE = uint8(RiskGate.Action.FREEZE);
    uint8 internal constant DEFAULT = uint8(RiskGate.Action.DEFAULT);

    function _deployExtensions() internal override {
        vault = new CollateralVault(registry, oracle, 300);
        riskGate = new RiskGate(registry, vault, oracle, signer, 900);
        _grantGate(address(riskGate));
        _grantGate(gate);
        vm.deal(issuer, hbar(1_000));
    }

    // ---------------------------------------------------------------- helpers

    /// @dev Signs `v` with SIGNER_PK over the contract's own EIP-712 digest (r || s || v layout, 65 bytes).
    function signVerdict(RiskGate.Verdict memory v) internal view returns (bytes memory) {
        (uint8 v8, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, riskGate.hashVerdict(v));
        return abi.encodePacked(r, s, v8);
    }

    function verdict(uint256 bondId_, uint8 action, uint256 cov, uint64 nonce)
        internal
        view
        returns (RiskGate.Verdict memory)
    {
        return RiskGate.Verdict({
            bondId: bondId_, action: action, coverageObserved: cov, issuedAt: uint64(block.timestamp), nonce: nonce
        });
    }

    /// @dev Sign before the prank: `hashVerdict` is an external call and would consume it.
    function _submit(RiskGate.Verdict memory v) internal {
        bytes memory sig = signVerdict(v);
        vm.prank(relayer);
        riskGate.submit(v, sig);
    }

    function _deposit(uint256 amount) internal {
        vm.prank(issuer);
        vault.deposit{value: amount}(bondId);
    }

    function _status() internal view returns (BondRegistry.Status) {
        return registry.status(bondId);
    }

    // ------------------------------------------------------------------ setup

    function test_constructor_storesConfig() public view {
        assertEq(address(riskGate.vault()), address(vault));
        assertEq(address(riskGate.oracle()), address(oracle));
        assertEq(address(riskGate.registry()), address(registry));
        assertEq(riskGate.signer(), signer);
        assertEq(riskGate.freshness(), 900);
        assertEq(riskGate.MAX_FUTURE_SKEW(), 300);
    }

    function test_hashVerdict_matchesManualEip712() public view {
        RiskGate.Verdict memory v = verdict(bondId, FREEZE, 250, 7);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("BondDeskRiskGate"),
                keccak256("1"),
                block.chainid,
                address(riskGate)
            )
        );
        bytes32 typeHash =
            keccak256("Verdict(uint256 bondId,uint8 action,uint256 coverageObserved,uint64 issuedAt,uint64 nonce)");
        bytes32 structHash =
            keccak256(abi.encode(typeHash, v.bondId, v.action, v.coverageObserved, v.issuedAt, v.nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));

        assertEq(riskGate.VERDICT_TYPEHASH(), typeHash);
        assertEq(riskGate.hashVerdict(v), digest);
        assertEq(ECDSA.recover(digest, signVerdict(v)), signer);

        (, string memory name, string memory version, uint256 chainId, address verifying,,) = riskGate.eip712Domain();
        assertEq(name, "BondDeskRiskGate");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(riskGate));
    }

    // ----------------------------------------------------------------- submit

    function test_submit_okRecordsOnly() public {
        RiskGate.Verdict memory v = verdict(bondId, OK, 500, 1);
        bytes memory sig = signVerdict(v);
        vm.expectEmit(true, true, true, true, address(riskGate));
        emit RiskGate.VerdictApplied(bondId, OK, 500, 1, relayer);
        vm.prank(relayer);
        riskGate.submit(v, sig);

        assertEq(uint8(_status()), uint8(BondRegistry.Status.Active));
        assertEq(riskGate.lastNonce(bondId), 1);
        (uint256 b, uint8 a, uint256 c, uint64 t, uint64 n) = riskGate.lastVerdict(bondId);
        assertEq(b, bondId);
        assertEq(a, OK);
        assertEq(c, 500);
        assertEq(t, uint64(block.timestamp));
        assertEq(n, 1);

        // no auto-unfreeze: OK after FREEZE leaves the bond Frozen
        _submit(verdict(bondId, FREEZE, 200, 2));
        _submit(verdict(bondId, OK, 600, 3));
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Frozen));
        assertEq(riskGate.lastNonce(bondId), 3);
    }

    function test_submit_warnRecordsOnly() public {
        _submit(verdict(bondId, WARN, 320, 1));
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Active));
        (, uint8 a, uint256 c,,) = riskGate.lastVerdict(bondId);
        assertEq(a, WARN);
        assertEq(c, 320);
        (uint256 snapshotId,) = vault.seizures(bondId);
        assertEq(snapshotId, 0);
    }

    function test_submit_freezeSetsFrozen() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit BondRegistry.StatusChanged(bondId, BondRegistry.Status.Active, BondRegistry.Status.Frozen);
        _submit(verdict(bondId, FREEZE, 250, 1));
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Frozen));
        (uint256 snapshotId,) = vault.seizures(bondId);
        assertEq(snapshotId, 0); // freeze never seizes
    }

    function test_submit_freezeIdempotentWhenFrozen() public {
        _submit(verdict(bondId, FREEZE, 250, 1));
        _submit(verdict(bondId, FREEZE, 240, 2));
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Frozen));
        assertEq(riskGate.lastNonce(bondId), 2);

        // FREEZE only transitions from Active: a Matured bond is left alone
        vm.prank(gate);
        registry.setStatus(bondId, BondRegistry.Status.Matured);
        _submit(verdict(bondId, FREEZE, 230, 3));
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Matured));
    }

    function test_submit_defaultSeizesAndSetsDefaulted() public {
        _deposit(HUNDRED);
        RiskGate.Verdict memory v = verdict(bondId, DEFAULT, 100, 1);
        bytes memory sig = signVerdict(v);

        vm.expectEmit(true, true, true, true, address(vault));
        emit CollateralVault.Seized(bondId, 1, HUNDRED);
        vm.expectEmit(true, true, true, true, address(registry));
        emit BondRegistry.StatusChanged(bondId, BondRegistry.Status.Active, BondRegistry.Status.Defaulted);
        vm.expectEmit(true, true, true, true, address(riskGate));
        emit RiskGate.VerdictApplied(bondId, DEFAULT, 100, 1, relayer);
        vm.prank(relayer);
        riskGate.submit(v, sig);

        assertEq(uint8(_status()), uint8(BondRegistry.Status.Defaulted));
        (uint256 snapshotId, uint256 amount) = vault.seizures(bondId);
        assertEq(snapshotId, 1);
        assertEq(amount, HUNDRED);
        assertEq(vault.collateral(bondId), 0);

        // holders (issuer holds all 100) can now claim
        uint256 before = issuer.balance;
        vm.prank(issuer);
        vault.claimSeized(bondId);
        assertEq(issuer.balance - before, HUNDRED);
    }

    function test_submit_defaultFromFrozen() public {
        _deposit(HUNDRED);
        _submit(verdict(bondId, FREEZE, 250, 1));
        _submit(verdict(bondId, DEFAULT, 100, 2));
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Defaulted));
        (uint256 snapshotId, uint256 amount) = vault.seizures(bondId);
        assertEq(snapshotId, 1);
        assertEq(amount, HUNDRED);
    }

    function test_submit_defaultIdempotentWhenDefaulted() public {
        _deposit(HUNDRED);
        _submit(verdict(bondId, DEFAULT, 100, 1));
        _submit(verdict(bondId, DEFAULT, 90, 2)); // records only: no second seize (would revert AlreadySeized)
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Defaulted));
        assertEq(riskGate.lastNonce(bondId), 2);
        assertEq(token.currentSnapshotId(), 1);
    }

    function test_submit_defaultNoopWhenMatured() public {
        _deposit(HUNDRED);
        vm.prank(gate);
        registry.setStatus(bondId, BondRegistry.Status.Matured);
        _submit(verdict(bondId, DEFAULT, 100, 1)); // recorded, but DEFAULT only fires from Active/Frozen
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Matured));
        assertEq(riskGate.lastNonce(bondId), 1);
        (uint256 snapshotId,) = vault.seizures(bondId);
        assertEq(snapshotId, 0);
        assertEq(token.currentSnapshotId(), 0);
        assertEq(vault.collateral(bondId), HUNDRED);
    }

    function test_submit_revertsBadSigner() public {
        RiskGate.Verdict memory v = verdict(bondId, FREEZE, 250, 1);
        (uint8 v8, bytes32 r, bytes32 s) = vm.sign(0xB0B, riskGate.hashVerdict(v));
        bytes memory sig = abi.encodePacked(r, s, v8);
        vm.prank(relayer);
        vm.expectRevert(RiskGate.BadSignature.selector);
        riskGate.submit(v, sig);

        // tampering with a signed field also fails
        RiskGate.Verdict memory tampered = verdict(bondId, DEFAULT, 250, 1);
        bytes memory good = signVerdict(v);
        vm.prank(relayer);
        vm.expectRevert(RiskGate.BadSignature.selector);
        riskGate.submit(tampered, good);
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Active));
    }

    /// @dev Malformed signatures must map to BadSignature (the only signature error in the spec), never leak OZ's
    ///      ECDSAInvalidSignatureLength / ECDSAInvalidSignatureS selectors to the relayer.
    function test_submit_revertsMalformedSignature() public {
        RiskGate.Verdict memory v = verdict(bondId, FREEZE, 250, 1);
        (uint8 v8, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, riskGate.hashVerdict(v));

        // 64 bytes: r || s without v
        vm.prank(relayer);
        vm.expectRevert(RiskGate.BadSignature.selector);
        riskGate.submit(v, abi.encodePacked(r, s));

        // high-s twin of a valid signature (malleable form; same raw ecrecover result, rejected by OZ)
        bytes32 sHigh = bytes32(SECP256K1_N - uint256(s));
        uint8 vFlip = v8 == 27 ? 28 : 27;
        vm.prank(relayer);
        vm.expectRevert(RiskGate.BadSignature.selector);
        riskGate.submit(v, abi.encodePacked(r, sHigh, vFlip));

        // bad v: ecrecover yields address(0)
        vm.prank(relayer);
        vm.expectRevert(RiskGate.BadSignature.selector);
        riskGate.submit(v, abi.encodePacked(r, s, uint8(0)));

        assertEq(uint8(_status()), uint8(BondRegistry.Status.Active));
        assertEq(riskGate.lastNonce(bondId), 0);
    }

    function test_submit_revertsNonceEqual() public {
        RiskGate.Verdict memory zero = verdict(bondId, OK, 500, 0);
        bytes memory sig0 = signVerdict(zero);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(RiskGate.StaleNonce.selector, 0, 0));
        riskGate.submit(zero, sig0);

        _submit(verdict(bondId, OK, 500, 1));
        RiskGate.Verdict memory v = verdict(bondId, FREEZE, 250, 1);
        bytes memory sig = signVerdict(v);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(RiskGate.StaleNonce.selector, 1, 1));
        riskGate.submit(v, sig);
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Active));
    }

    function test_submit_revertsNonceLower() public {
        _submit(verdict(bondId, OK, 500, 5));
        RiskGate.Verdict memory v = verdict(bondId, FREEZE, 250, 3);
        bytes memory sig = signVerdict(v);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(RiskGate.StaleNonce.selector, 3, 5));
        riskGate.submit(v, sig);
        assertEq(riskGate.lastNonce(bondId), 5);
    }

    function test_submit_revertsStale() public {
        uint64 nowTs = uint64(block.timestamp);
        RiskGate.Verdict memory v = verdict(bondId, FREEZE, 250, 1);
        v.issuedAt = nowTs - 901;
        bytes memory sig = signVerdict(v);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(RiskGate.StaleVerdict.selector, nowTs - 901, nowTs));
        riskGate.submit(v, sig);

        v.issuedAt = nowTs - 900; // exactly `freshness` old is still accepted
        _submit(v);
        assertEq(riskGate.lastNonce(bondId), 1);
    }

    function test_submit_revertsFuture() public {
        uint64 nowTs = uint64(block.timestamp);
        RiskGate.Verdict memory v = verdict(bondId, FREEZE, 250, 1);
        v.issuedAt = nowTs + 301;
        bytes memory sig = signVerdict(v);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(RiskGate.FutureVerdict.selector, nowTs + 301, nowTs));
        riskGate.submit(v, sig);

        v.issuedAt = nowTs + 300; // within MAX_FUTURE_SKEW
        _submit(v);
        assertEq(riskGate.lastNonce(bondId), 1);
    }

    function test_submit_revertsBadAction() public {
        RiskGate.Verdict memory v = verdict(bondId, 4, 250, 1);
        bytes memory sig = signVerdict(v);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(RiskGate.BadAction.selector, 4));
        riskGate.submit(v, sig);

        v.action = 255;
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(RiskGate.BadAction.selector, 255));
        riskGate.submit(v, sig); // checked before the signature
    }

    function test_submit_anyoneCanRelay() public {
        address anyone = makeAddr("anyone");
        RiskGate.Verdict memory v = verdict(bondId, FREEZE, 250, 1);
        bytes memory sig = signVerdict(v);
        vm.expectEmit(true, true, true, true, address(riskGate));
        emit RiskGate.VerdictApplied(bondId, FREEZE, 250, 1, anyone);
        vm.prank(anyone);
        riskGate.submit(v, sig);
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Frozen));

        RiskGate.Verdict memory v2 = verdict(bondId, OK, 500, 2);
        bytes memory sig2 = signVerdict(v2);
        vm.prank(inv3);
        riskGate.submit(v2, sig2);
        assertEq(riskGate.lastNonce(bondId), 2);
    }

    /// @dev Nonces are strictly increasing per bond: equal or lower always reverts, higher always lands.
    function testFuzz_submit_nonceStrictlyIncreasing(uint64 first, uint64 second) public {
        first = uint64(bound(first, 1, type(uint64).max - 1));
        _submit(verdict(bondId, OK, 500, first));
        assertEq(riskGate.lastNonce(bondId), first);

        RiskGate.Verdict memory v = verdict(bondId, WARN, 400, second);
        bytes memory sig = signVerdict(v);
        vm.prank(relayer);
        if (second > first) {
            riskGate.submit(v, sig);
            assertEq(riskGate.lastNonce(bondId), second);
        } else {
            vm.expectRevert(abi.encodeWithSelector(RiskGate.StaleNonce.selector, second, first));
            riskGate.submit(v, sig);
            assertEq(riskGate.lastNonce(bondId), first);
        }
    }

    // --------------------------------------------------------------- unfreeze

    function test_unfreeze_onlyAdmin() public {
        _submit(verdict(bondId, FREEZE, 250, 1));
        vm.prank(issuer);
        vm.expectRevert(RegistryAuth.NotAdmin.selector);
        riskGate.unfreeze(bondId);

        vm.expectEmit(true, true, true, true, address(registry));
        emit BondRegistry.StatusChanged(bondId, BondRegistry.Status.Frozen, BondRegistry.Status.Active);
        vm.expectEmit(true, true, true, true, address(riskGate));
        emit RiskGate.Unfrozen(bondId);
        vm.prank(admin);
        riskGate.unfreeze(bondId);
        assertEq(uint8(_status()), uint8(BondRegistry.Status.Active));
    }

    function test_unfreeze_revertsIfNotFrozen() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(RiskGate.NotFrozen.selector, BondRegistry.Status.Active));
        riskGate.unfreeze(bondId);

        _submit(verdict(bondId, DEFAULT, 100, 1));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(RiskGate.NotFrozen.selector, BondRegistry.Status.Defaulted));
        riskGate.unfreeze(bondId);
    }

    // ------------------------------------------------------------------ admin

    function test_setSigner_onlyAdmin() public {
        address newSigner = makeAddr("newSigner");
        vm.prank(issuer);
        vm.expectRevert(RegistryAuth.NotAdmin.selector);
        riskGate.setSigner(newSigner);

        vm.expectEmit(true, true, true, true, address(riskGate));
        emit RiskGate.SignerSet(newSigner);
        vm.prank(admin);
        riskGate.setSigner(newSigner);
        assertEq(riskGate.signer(), newSigner);

        RiskGate.Verdict memory v = verdict(bondId, OK, 500, 1);
        bytes memory sig = signVerdict(v); // old key
        vm.prank(relayer);
        vm.expectRevert(RiskGate.BadSignature.selector);
        riskGate.submit(v, sig);
    }

    function test_setFreshness_onlyAdmin() public {
        vm.prank(issuer);
        vm.expectRevert(RegistryAuth.NotAdmin.selector);
        riskGate.setFreshness(10);

        vm.expectEmit(true, true, true, true, address(riskGate));
        emit RiskGate.FreshnessSet(10);
        vm.prank(admin);
        riskGate.setFreshness(10);
        assertEq(riskGate.freshness(), 10);

        uint64 nowTs = uint64(block.timestamp);
        RiskGate.Verdict memory v = verdict(bondId, OK, 500, 1);
        v.issuedAt = nowTs - 11;
        bytes memory sig = signVerdict(v);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(RiskGate.StaleVerdict.selector, nowTs - 11, nowTs));
        riskGate.submit(v, sig);
    }

    // --------------------------------------------------------------- snapshot

    function test_snapshot_returnsAllFields() public {
        _deposit(HUNDRED);
        _submit(verdict(bondId, WARN, 480, 3));

        RiskGate.Snapshot memory s = riskGate.snapshot(bondId);
        assertEq(s.coverageBps, 500);
        assertTrue(s.feedFresh);
        assertEq(s.status, uint8(BondRegistry.Status.Active));
        assertEq(s.mark, oracle.mark(bondId));
        assertGt(s.mark, 1e6); // accrual is running
        assertEq(s.collateral, HUNDRED);
        assertEq(s.lastNonce, 3);
        assertEq(s.lastAction, WARN);
        assertEq(s.nextCoupon, uint64(START + 1 days));
        assertEq(s.maturity, uint64(token.getMaturityDate()));
        assertEq(s.timestamp, uint64(block.timestamp));
    }

    function test_snapshot_revertsUnknownBond() public {
        vm.expectRevert(abi.encodeWithSelector(BondRegistry.UnknownBond.selector, 999));
        riskGate.snapshot(999);
    }

    function test_snapshot_feedStaleFlag() public {
        _deposit(HUNDRED);
        vm.warp(START + 90_001);
        RiskGate.Snapshot memory s = riskGate.snapshot(bondId);
        assertFalse(s.feedFresh);
        assertEq(s.coverageBps, 0);
        assertEq(s.collateral, HUNDRED); // the rest is still reported
        assertEq(s.status, uint8(BondRegistry.Status.Active));
        assertEq(s.timestamp, uint64(START + 90_001));

        feed.setAnswer(5_000_000);
        s = riskGate.snapshot(bondId);
        assertTrue(s.feedFresh);
        assertEq(s.coverageBps, 500);
    }
}
