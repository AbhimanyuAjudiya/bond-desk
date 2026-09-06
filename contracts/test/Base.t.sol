// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HederaTest} from "hedera-harness/HederaTest.sol";
import {BondRegistry} from "../src/BondRegistry.sol";
import {NavOracle} from "../src/NavOracle.sol";
import {MockATSBond} from "../src/mocks/MockATSBond.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";

/// @notice Shared fixture: HSS/HTS mocks etched at 0x16b/0x167, mocks + registry + oracle, seven actors, bond 1 registered.
/// @dev Integration (E): deploy vault / market / lifecycle / riskGate inside `_deployExtensions`.
///      `warpAndExecute` / `executeDueSchedules` (HederaTest) drive scheduled calls in C / E tests.
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

    /// @dev Hook: A / B / C deploy only their own contract here; E deploys vault, market, lifecycle, riskGate and
    ///      grants GATE_ROLE (registry) / ROLE_SNAPSHOT, ROLE_MATURITY_REDEEMER (token).
    function _deployExtensions() internal virtual {}

    function _kyc(address who) internal {
        token.grantKyc(who, "vc:demo", block.timestamp - 1, block.timestamp + 3650 days, issuer);
    }

    function _grantGate(address who) internal {
        bytes32 gate = registry.GATE_ROLE();
        vm.prank(admin);
        registry.grantRole(gate, who);
    }

    // `signVerdict(...)` / `verdict(bondId, action, cov, nonce)` helpers land with RiskGate (A / E).
}
