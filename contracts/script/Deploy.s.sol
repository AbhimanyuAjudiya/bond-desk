// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {HederaHarness} from "hedera-harness/HederaHarness.sol";
import {MockHSS} from "hedera-harness/mocks/MockHSS.sol";
import {IATSAdmin} from "ats/IATSAdmin.sol";
import {ROLE_SNAPSHOT, ROLE_MATURITY_REDEEMER} from "ats/ATSRoles.sol";
import {BondRegistry} from "../src/BondRegistry.sol";
import {NavOracle} from "../src/NavOracle.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {BondMarket} from "../src/BondMarket.sol";
import {BondLifecycle} from "../src/BondLifecycle.sol";
import {RiskGate} from "../src/RiskGate.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

/// @notice Deploy the desk on Hedera testnet around the ATS bond from `ats/testnet.json`: six contracts, roles,
///         bond 1 registered, ATS roles for lifecycle/vault, the HSS payer float, the first coupon scheduled, and
///         `deployments/testnet.json` written for the demo, the API, the relayer and `verify.sh`.
/// @dev Run (deployer = admin = issuer = ATS admin), two commands:
///        forge script contracts/script/Deploy.s.sol:Deploy --rpc-url hedera --broadcast --slow --skip-simulation -vvvv
///        forge script contracts/script/Deploy.s.sol:Deploy --sig "patchSchedule()" --rpc-url hedera
///      `--skip-simulation` is mandatory: forge's local EVM has no code at 0x16b, so `lifecycle.schedule` would
///      revert before anything is broadcast. `MockHSS` is etched for the local run only (cheatcode state never
///      reaches the chain), so `run()` can only write the mock's schedule address to the artifact. `patchSchedule()`
///      (no broadcast, no etch) reads `lifecycle.scheduleOf(bondId)` from the chain and overwrites `.schedule`;
///      the demo's `jq -r .schedule` and `harness/scripts/validate-schedule.sh` depend on that second step.
///      Env (default): HEDERA_PRIVATE_KEY, RISK_SIGNER (required); BOND_TOKEN (ats/testnet.json .bond.token);
///        SETTLEMENT (empty -> MockUSDC + 1e12 to issuer / INVESTOR1 / INVESTOR2 / INVESTOR3_NOKYC);
///        HBAR_USD_FEED (Chainlink HBAR/USD testnet); TREASURY (deployer); FEE_BPS (0); MIN_COVERAGE_BPS (300);
///        STALE_AFTER (90000); FRESHNESS (900); FACE_VALUE (1000000); COUPON_BPS (500); COUPON_INTERVAL (86400);
///        FIRST_COUPON_DELAY (600); LIFECYCLE_FUND (20 ether = 20 HBAR: the relay divides by 1e10);
///        DEPLOYMENTS_OUT (deployments/testnet.json; must stay under ./deployments, see fs_permissions).
contract Deploy is Script {
    struct Cfg {
        uint256 staleAfter;
        uint256 minCoverageBps;
        uint16 feeBps;
        uint64 freshness;
        uint256 faceValue;
        uint256 couponBps;
        uint64 couponInterval;
        uint64 firstCouponDelay;
        uint256 fund;
        address inv1;
        address inv2;
        address inv3;
    }

    struct Out {
        BondRegistry registry;
        NavOracle oracle;
        CollateralVault vault;
        BondMarket market;
        BondLifecycle lifecycle;
        RiskGate riskGate;
        address token;
        address settlement;
        address feed;
        address signer;
        address treasury;
        uint256 bondId;
        address schedule;
        bool mockUsdc;
    }

    error FundFailed();
    error BadFloat(uint256 balance);
    error NoSchedule();

    function run() external {
        uint256 pk = vm.envUint("HEDERA_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        Cfg memory c = Cfg({
            staleAfter: vm.envOr("STALE_AFTER", uint256(90_000)),
            minCoverageBps: vm.envOr("MIN_COVERAGE_BPS", uint256(300)),
            feeBps: uint16(vm.envOr("FEE_BPS", uint256(0))),
            freshness: uint64(vm.envOr("FRESHNESS", uint256(900))),
            faceValue: vm.envOr("FACE_VALUE", uint256(1_000_000)),
            couponBps: vm.envOr("COUPON_BPS", uint256(500)),
            couponInterval: uint64(vm.envOr("COUPON_INTERVAL", uint256(86_400))),
            firstCouponDelay: uint64(vm.envOr("FIRST_COUPON_DELAY", uint256(600))),
            fund: vm.envOr("LIFECYCLE_FUND", uint256(20 ether)),
            inv1: vm.envOr("INVESTOR1", address(0)),
            inv2: vm.envOr("INVESTOR2", address(0)),
            inv3: vm.envOr("INVESTOR3_NOKYC", address(0))
        });
        Out memory o;
        o.token = vm.envOr("BOND_TOKEN", address(0));
        if (o.token == address(0)) o.token = vm.parseJsonAddress(vm.readFile("ats/testnet.json"), ".bond.token");
        o.settlement = vm.envOr("SETTLEMENT", address(0));
        o.feed = vm.envOr("HBAR_USD_FEED", 0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a);
        o.signer = vm.envAddress("RISK_SIGNER");
        o.treasury = vm.envOr("TREASURY", deployer);
        if (block.chainid != HederaHarness.CHAIN_TESTNET) {
            console.log("WARN: chain %s is not Hedera testnet (296)", block.chainid);
        }

        // Local run only: cheatcode state never reaches the chain (see header).
        vm.etch(address(HederaHarness.HSS), type(MockHSS).runtimeCode);

        vm.startBroadcast(pk);
        if (o.settlement == address(0)) {
            MockUSDC usdc = new MockUSDC();
            o.settlement = address(usdc);
            o.mockUsdc = true;
            _mint(usdc, deployer);
            _mint(usdc, c.inv1);
            _mint(usdc, c.inv2);
            _mint(usdc, c.inv3);
        }
        o.registry = new BondRegistry(deployer);
        o.oracle = new NavOracle(o.registry, AggregatorV3Interface(o.feed), c.staleAfter);
        o.vault = new CollateralVault(o.registry, o.oracle, c.minCoverageBps);
        o.market = new BondMarket(o.registry, o.oracle, o.treasury, c.feeBps);
        o.lifecycle = new BondLifecycle(o.registry);
        o.riskGate = new RiskGate(o.registry, o.vault, o.oracle, o.signer, c.freshness);

        bytes32 issuerRole = o.registry.ISSUER_ROLE();
        bytes32 gateRole = o.registry.GATE_ROLE();
        o.registry.grantRole(issuerRole, deployer);
        o.registry.grantRole(gateRole, address(o.riskGate));
        o.registry.grantRole(gateRole, address(o.lifecycle));

        uint64 maturity = uint64(IATSAdmin(o.token).getMaturityDate());
        o.bondId = o.registry.register(
            o.token,
            o.settlement,
            c.faceValue,
            c.couponBps,
            c.couponInterval,
            uint64(block.timestamp) + c.firstCouponDelay,
            maturity
        );
        IATSAdmin(o.token).grantRole(ROLE_SNAPSHOT, address(o.lifecycle));
        IATSAdmin(o.token).grantRole(ROLE_SNAPSHOT, address(o.vault));
        IATSAdmin(o.token).grantRole(ROLE_MATURITY_REDEEMER, address(o.lifecycle));

        (bool sent,) = address(o.lifecycle).call{value: c.fund}("");
        if (!sent) revert FundFailed();
        o.lifecycle.schedule(o.bondId);
        vm.stopBroadcast();

        // Denomination check. On Hedera the contract holds fund / 1e10 tinybar. This read happens in forge's local
        // fork EVM (18-dec, before anything is broadcast), so the WARN branch is the expected output even on Hedera;
        // the on-chain tinybar view is `Demo.runStatus()` after `runCollateral()` (collateral raw == 1e10 for 100 HBAR).
        uint256 bal = address(o.lifecycle).balance;
        if (bal == c.fund / HederaHarness.WEIBAR_PER_TINYBAR) {
            console.log("lifecycle float: %s tinybar", bal);
        } else if (bal == c.fund) {
            console.log("WARN: local EVM sees lifecycle balance == LIFECYCLE_FUND (18-dec); on Hedera the chain holds %s tinybar", c.fund / 1e10);
        } else {
            revert BadFloat(bal);
        }
        o.schedule = o.lifecycle.scheduleOf(o.bondId); // mock's answer locally; patchSchedule() writes the real one

        _log(o, deployer);
        _write(o, c, deployer);
    }

    /// @notice Overwrite `.schedule` in the artifact with the on-chain HSS address (run without --broadcast, after run()).
    function patchSchedule() external {
        string memory path = vm.envOr("DEPLOYMENTS_OUT", string("deployments/testnet.json"));
        string memory j = vm.readFile(path);
        BondLifecycle lifecycle = BondLifecycle(payable(vm.parseJsonAddress(j, ".lifecycle")));
        address schedule = lifecycle.scheduleOf(vm.parseJsonUint(j, ".bondId"));
        if (schedule == address(0)) revert NoSchedule();
        vm.writeJson(vm.toString(schedule), path, ".schedule");
        console.log("schedule (on-chain):", schedule);
        console.log("wrote", path);
    }

    function _mint(MockUSDC usdc, address to) internal {
        if (to != address(0)) usdc.mint(to, 1e12);
    }

    function _log(Out memory o, address deployer) internal view {
        console.log("deployer / issuer:", deployer);
        console.log("registry:  ", address(o.registry));
        console.log("oracle:    ", address(o.oracle));
        console.log("vault:     ", address(o.vault));
        console.log("market:    ", address(o.market));
        console.log("lifecycle: ", address(o.lifecycle));
        console.log("riskGate:  ", address(o.riskGate));
        console.log("settlement:", o.settlement);
        console.log("bond token:", o.token);
        console.log("bondId:    ", o.bondId);
        console.log("schedule (local mock; run patchSchedule() for the on-chain one):", o.schedule);
        try o.vault.coverageBps(o.bondId) returns (uint256 cov) {
            console.log("coverageBps(1): %s", cov);
        } catch {
            console.log("coverageBps(1): feed stale / unreadable");
        }
        RiskGate.Snapshot memory s = o.riskGate.snapshot(o.bondId);
        console.log("snapshot(1): coverage %s feedFresh %s status %s", s.coverageBps, s.feedFresh, s.status);
        console.log("snapshot(1): mark %s nextCoupon %s maturity %s", s.mark, s.nextCoupon, s.maturity);
    }

    /// @dev Flat shape consumed by Demo.s.sol, verify.sh, api/ and relayer/. `args` are the abi-encoded
    ///      constructor args for `forge verify-contract --constructor-args`.
    function _write(Out memory o, Cfg memory c, address deployer) internal {
        string memory w = "wallets";
        vm.serializeAddress(w, "issuer", deployer);
        vm.serializeAddress(w, "investorKyc1", c.inv1);
        vm.serializeAddress(w, "investorKyc2", c.inv2);
        string memory wallets = vm.serializeAddress(w, "investorNoKyc", c.inv3);

        string memory a = "args";
        vm.serializeString(a, "registry", vm.toString(abi.encode(deployer)));
        vm.serializeString(a, "oracle", vm.toString(abi.encode(o.registry, o.feed, c.staleAfter)));
        vm.serializeString(a, "vault", vm.toString(abi.encode(o.registry, o.oracle, c.minCoverageBps)));
        vm.serializeString(a, "market", vm.toString(abi.encode(o.registry, o.oracle, o.treasury, c.feeBps)));
        vm.serializeString(a, "lifecycle", vm.toString(abi.encode(o.registry)));
        if (o.mockUsdc) vm.serializeString(a, "settlement", "0x");
        string memory args =
            vm.serializeString(a, "riskGate", vm.toString(abi.encode(o.registry, o.vault, o.oracle, o.signer, c.freshness)));

        string memory r = "deployment";
        vm.serializeUint(r, "chainId", block.chainid);
        vm.serializeAddress(r, "deployer", deployer);
        vm.serializeUint(r, "block", block.number);
        vm.serializeAddress(r, "registry", address(o.registry));
        vm.serializeAddress(r, "oracle", address(o.oracle));
        vm.serializeAddress(r, "vault", address(o.vault));
        vm.serializeAddress(r, "market", address(o.market));
        vm.serializeAddress(r, "lifecycle", address(o.lifecycle));
        vm.serializeAddress(r, "riskGate", address(o.riskGate));
        vm.serializeAddress(r, "settlement", o.settlement);
        vm.serializeAddress(r, "token", o.token);
        vm.serializeUint(r, "bondId", o.bondId);
        vm.serializeAddress(r, "feed", o.feed);
        vm.serializeAddress(r, "signer", o.signer);
        vm.serializeAddress(r, "schedule", o.schedule);
        vm.serializeString(r, "wallets", wallets);
        string memory out = vm.serializeString(r, "args", args);

        string memory path = vm.envOr("DEPLOYMENTS_OUT", string("deployments/testnet.json"));
        vm.writeJson(out, path);
        console.log("wrote", path);
    }
}
