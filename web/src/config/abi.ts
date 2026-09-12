import { parseAbi } from "viem"

// Typed, human-readable subsets of the contracts the app calls. `abi.test.ts` checks every selector against the
// generated ABIs in api/src/abi, so a contract change that touches these fails the test suite instead of a demo.
export const registryAbi = parseAbi([
  "function bondCount() view returns (uint256)",
  "function terms(uint256 bondId) view returns ((address token, address settlement, address issuer, uint8 bondDecimals, uint8 settlementDecimals, uint256 faceValue, uint256 couponRateBps, uint64 couponInterval, uint64 nextCoupon, uint64 maturity, uint8 status))",
  "function status(uint256 bondId) view returns (uint8)",
  "function isAdmin(address account) view returns (bool)",
  "function isIssuer(uint256 bondId, address account) view returns (bool)",
])

export const marketAbi = parseAbi([
  "function place(uint256 bondId, bool isSell, uint128 amount, uint128 price, uint64 expiry) returns (uint256)",
  "function cancel(uint256 orderId)",
  "function fill(uint256 orderId, uint128 amount)",
  "function orders(uint256 orderId) view returns (uint256 bondId, address maker, bool isSell, uint128 amount, uint128 price, uint64 expiry)",
  "function quote(uint256 bondId) view returns (uint128 bestBid, uint128 bestAsk)",
  "function feeBps() view returns (uint16)",
  "function bandBps(uint256 bondId) view returns (uint16)",
  "error ComplianceRejected(bytes1 code, bytes32 reason)",
  "error BondNotActive(uint256 bondId, uint8 s)",
])

export const lifecycleAbi = parseAbi([
  "function fund(uint256 bondId, uint256 amount)",
  "function funded(uint256 bondId) view returns (uint256)",
  "function couponCount(uint256 bondId) view returns (uint256)",
  "function coupons(uint256 bondId, uint256 couponId) view returns (uint256 snapshotId, uint256 amount, uint256 claimedTotal, uint64 paidAt)",
  "function claimable(uint256 bondId, uint256 couponId, address holder) view returns (uint256)",
  "function claim(uint256 bondId, uint256 couponId)",
  "function couponDue(uint256 bondId) view returns (uint256)",
  "function payCoupon(uint256 bondId)",
  "function schedule(uint256 bondId)",
  "function scheduleOf(uint256 bondId) view returns (address)",
  "function scheduledFor(uint256 bondId) view returns (uint64)",
  "function redeem(uint256 bondId)",
])

export const vaultAbi = parseAbi([
  "function deposit(uint256 bondId) payable",
  "function withdraw(uint256 bondId, uint256 amount)",
  "function collateral(uint256 bondId) view returns (uint256)",
  "function coverageBps(uint256 bondId) view returns (uint256)",
  "function minCoverageBps() view returns (uint256)",
  "function seizures(uint256 bondId) view returns (uint256 snapshotId, uint256 amount)",
  "function claimSeized(uint256 bondId)",
])

export const riskGateAbi = parseAbi([
  "function snapshot(uint256 bondId) view returns ((uint256 coverageBps, bool feedFresh, uint8 status, uint256 mark, uint256 collateral, uint64 lastNonce, uint8 lastAction, uint64 nextCoupon, uint64 maturity, uint64 timestamp))",
  "function signer() view returns (address)",
  "function freshness() view returns (uint64)",
  "function lastVerdict(uint256 bondId) view returns (uint256 bondId, uint8 action, uint256 coverageObserved, uint64 issuedAt, uint64 nonce)",
  "function submit((uint256 bondId, uint8 action, uint256 coverageObserved, uint64 issuedAt, uint64 nonce) v, bytes sig)",
  "function unfreeze(uint256 bondId)",
])

export const oracleAbi = parseAbi([
  "function hbarUsd() view returns (uint256)",
  "function mark(uint256 bondId) view returns (uint256)",
  "function staleAfter() view returns (uint256)",
])

export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function mint(address to, uint256 amount)",
])

// ATS bond diamond: runtime surface (IATSBond) plus the admin facets (IATSAdmin) the compliance page uses.
export const tokenAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function getKycStatusFor(address account) view returns (uint8)",
  "function isFrozen(address account) view returns (bool)",
  // setAddressFrozen puts the account on the control list; isFrozen is a different (partition) flag and stays false
  "function isInControlList(address account) view returns (bool)",
  "function paused() view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function isIssuer(address issuer) view returns (bool)",
  "function canTransferFrom(address from, address to, uint256 value, bytes data) view returns (bool ok, bytes1 code, bytes32 reason)",
  "function getMaturityDate() view returns (uint256)",
  "function addIssuer(address issuer) returns (bool)",
  "function grantKyc(address account, string vcId, uint256 validFrom, uint256 validTo, address issuer) returns (bool)",
  "function revokeKyc(address account) returns (bool)",
  "function setAddressFrozen(address account, bool freezeStatus)",
])

// ats/src/ATSRoles.sol, verbatim.
export const ROLES = {
  KYC: "0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc",
  FREEZE_MANAGER: "0x71ae38482e1ab1c28e767d64766d686215b490c8c1bd7dfe6b101525187c2155",
  PAUSER: "0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f",
  SSI_MANAGER: "0x3120494a82251fe85b0403877539486dbfcf0f94c20741a3229cfad31f625ee1",
} as const
