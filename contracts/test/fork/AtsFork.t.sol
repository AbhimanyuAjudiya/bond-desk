// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IATSBond} from "../../src/interfaces/IATSBond.sol";
import {MockATSBond} from "../../src/mocks/MockATSBond.sol";

/// @notice The real ATS bond from `ats/testnet.json` (written by `ats/script/CreateBond.s.sol`): compliance answers
///         the mock reproduces, checked against the live diamond.
/// @dev `FORK=1 FOUNDRY_PROFILE=fork forge test --fork-url https://testnet.hashio.io/api -vv`; skipped when FORK is
///      unset or `bond.token` has not been written yet.
contract AtsForkTest is Test {
    IATSBond internal token;
    address internal issuer;
    address internal inv1;
    address internal nonKyc;
    bool internal ready;

    function setUp() public {
        if (!vm.envOr("FORK", false)) return;
        string memory j = vm.readFile("ats/testnet.json");
        if (!vm.keyExistsJson(j, ".bond.token")) return;
        token = IATSBond(vm.parseJsonAddress(j, ".bond.token"));
        issuer = vm.parseJsonAddress(j, ".bond.issuer");
        inv1 = vm.parseJsonAddressArray(j, ".bond.investors")[0];
        nonKyc = vm.parseJsonAddress(j, ".bond.nonKyc");
        ready = address(token).code.length > 0;
    }

    modifier fork() {
        if (!vm.envOr("FORK", false) || !ready) {
            vm.skip(true);
            return;
        }
        _;
    }

    function test_fork_canTransferFrom_kycPairOk() public fork {
        vm.prank(issuer);
        (bool ok, bytes1 code, bytes32 reason) = token.canTransferFrom(issuer, inv1, 1, "");
        assertTrue(ok);
        assertEq(code, bytes1(0x01));
        assertEq(reason, bytes32(0));
    }

    function test_fork_canTransferFrom_nonKycBuyerRejected_0x10() public fork {
        vm.prank(issuer);
        (bool ok, bytes1 code, bytes32 reason) = token.canTransferFrom(issuer, nonKyc, 1, "");
        assertFalse(ok);
        assertEq(code, bytes1(0x10));
        assertEq(reason, bytes32(MockATSBond.InvalidKycStatus.selector));
    }

    function test_fork_getKycStatusFor() public fork {
        assertEq(token.getKycStatusFor(issuer), 1);
        assertEq(token.getKycStatusFor(inv1), 1);
        assertEq(token.getKycStatusFor(nonKyc), 0);
    }

    /// @dev KYC is checked for from/to only: an operator without KYC (the market) is stopped by nothing but
    ///      allowance / balance (0x54), never by 0x10 / InvalidKycStatus.
    function test_fork_marketNotKycd_stillPassesOperatorCheck() public fork {
        address marketLike = makeAddr("market");
        assertEq(token.getKycStatusFor(marketLike), 0);
        vm.prank(marketLike);
        (bool ok, bytes1 code, bytes32 reason) = token.canTransferFrom(issuer, inv1, 1, "");
        console2.log("operator check: ok=%s code=%s", ok, vm.toString(abi.encodePacked(code)));
        assertTrue(reason != bytes32(MockATSBond.InvalidKycStatus.selector));
        assertTrue(ok || code == bytes1(0x54));
    }
}
