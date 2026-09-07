// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HederaTest} from "hedera-harness/HederaTest.sol";
import {ROLE_SNAPSHOT, ROLE_MATURITY_REDEEMER} from "ats/ATSRoles.sol";
import {BondRegistry} from "../src/BondRegistry.sol";
import {NavOracle} from "../src/NavOracle.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {BondMarket} from "../src/BondMarket.sol";
import {BondLifecycle} from "../src/BondLifecycle.sol";
import {RiskGate} from "../src/RiskGate.sol";
import {MockATSBond} from "../src/mocks/MockATSBond.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";

/// @notice Shared fixture: HSS/HTS mocks etched at 0x16b/0x167, mocks + registry + oracle, seven actors, bond 1 registered.
/// @dev Unit suites (A / B / C) deploy only their own contract in `_deployExtensions`; the full desk lives in
///      `BondDeskFullTest` below. `warpAndExecute` / `executeDueSchedules` (HederaTest) drive scheduled calls.
abstract contract BondDeskTest is HederaTest {
    uint256 internal constant START = 1_700_000_000; // fixture clock; keeps `now - x` away from timestamp 1
    uint256 internal constant SIGNER_PK = 0xA11CE;

    address internal admin = makeAddr("admin");
    address internal issuer = makeAddr("issuer");
    address internal officer = makeAddr("officer");
    address internal inv1 = makeAddr("inv1");
    address internal inv2 = makeAddr("inv2");
    address internal inv3 = makeAddr("inv3"); // never KYC'd
    address internal relayer = makeAddr("relayer");
    address internal signer = vm.addr(SIGNER_PK); // RiskGate verdict signer (A / E)

    MockUSDC internal usdc;
    MockAggregatorV3 internal feed;
    MockATSBond internal token;
    BondRegistry internal registry;
    NavOracle internal oracle;
    uint256 internal bondId;

    function setUp() public virtual override {
        installHedera(); // before `_deployExtensions`: C's lifecycle `schedule()` calls 0x16b in setUp
        vm.warp(START);
        usdc = new MockUSDC();
        feed = new MockAggregatorV3(8, 5_000_000); // HBAR/USD = $0.05
        token = new MockATSBond("B", "B", 0, block.timestamp + 365 days);
        registry = new BondRegistry(admin);
        oracle = new NavOracle(registry, feed, 90_000);

        bytes32 issuerRole = registry.ISSUER_ROLE();
        vm.prank(admin);
        registry.grantRole(issuerRole, issuer);

        token.addIssuer(issuer);
        _kyc(issuer);
        _kyc(inv1);
        _kyc(inv2);
        token.mint(issuer, 100);

        address[7] memory all = [admin, issuer, officer, inv1, inv2, inv3, relayer];
        for (uint256 i; i < all.length; ++i) {
            usdc.mint(all[i], 1e12);
        }

        uint64 maturity = uint64(token.getMaturityDate()); // read before the prank: calls in the arg list consume it
        vm.prank(issuer);
        bondId = registry.register(address(token), address(usdc), 1e6, 500, 30 days, uint64(block.timestamp + 1 days), maturity);

        _deployExtensions();
    }

    /// @dev Hook: A / B / C deploy only their own contract here; `BondDeskFullTest` deploys the whole desk.
    function _deployExtensions() internal virtual {}

    function _kyc(address who) internal {
        token.grantKyc(who, "vc:demo", block.timestamp - 1, block.timestamp + 3650 days, issuer);
    }

    function _grantGate(address who) internal {
        bytes32 gate = registry.GATE_ROLE();
        vm.prank(admin);
        registry.grantRole(gate, who);
    }
}

/// @notice The whole desk wired exactly as `contracts/script/Deploy.s.sol` wires it: vault (minCov 300 bps),
///         market (no fee), lifecycle (20 HBAR HSS float), riskGate (signer, freshness 900), registry GATE_ROLE for
///         riskGate + lifecycle, ATS ROLE_SNAPSHOT for lifecycle + vault, ROLE_MATURITY_REDEEMER for lifecycle,
///         and every actor pre-approved on market + lifecycle. Storyline / fork tests extend this.
/// @dev Kept separate from `BondDeskTest` because the unit suites declare same-named members locally.
abstract contract BondDeskFullTest is BondDeskTest {
    CollateralVault internal vault;
    BondMarket internal market;
    BondLifecycle internal lifecycle;
    RiskGate internal riskGate;
    address internal treasury = makeAddr("treasury");

    function _deployExtensions() internal virtual override {
        vault = new CollateralVault(registry, oracle, 300);
        market = new BondMarket(registry, oracle, treasury, 0);
        lifecycle = new BondLifecycle(registry);
        riskGate = new RiskGate(registry, vault, oracle, signer, 900);
        _grantGate(address(riskGate));
        _grantGate(address(lifecycle));
        token.grantRole(ROLE_SNAPSHOT, address(lifecycle));
        token.grantRole(ROLE_SNAPSHOT, address(vault));
        token.grantRole(ROLE_MATURITY_REDEEMER, address(lifecycle));
        vm.deal(issuer, hbar(1_000));
        vm.deal(address(lifecycle), hbar(20)); // HSS payer float

        address[4] memory all = [issuer, inv1, inv2, inv3];
        for (uint256 i; i < all.length; ++i) {
            vm.startPrank(all[i]);
            token.approve(address(market), type(uint256).max);
            usdc.approve(address(market), type(uint256).max);
            usdc.approve(address(lifecycle), type(uint256).max);
            vm.stopPrank();
        }
    }

    /// @dev Signs `v` with SIGNER_PK over the gate's EIP-712 digest (r || s || v, 65 bytes).
    ///      Call before any `vm.prank`: `hashVerdict` is an external call and would consume it.
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
}
