import { keccak256, toBytes, toFunctionSelector } from "viem";

const expected = new Map([
  [
    "receiveCallback(uint256,(address,bytes,uint8,uint256,uint256,uint256)[],uint8)",
    "0xd2d73854",
  ],
  ["inferString(string,string,bool,string[])", "0xfe7ca098"],
  ["inferNumber(string,string,int256,int256,bool)", "0xc6833c3d"],
  ["inferChat(string[],string[],bool)", "0xbee8d139"],
  [
    "inferToolsChat(string[],string[],string[],(string,string)[],uint256,bool)",
    "0xd0683905",
  ],
  ["fetchString(string,string)", "0xe003c22e"],
  ["fetchUint(string,string,uint8)", "0x3bbc1302"],
  ["fetchInt(string,string,uint8)", "0xac0ea076"],
  ["fetchBool(string,string)", "0x5cd80388"],
  ["fetchStringArray(string,string)", "0xe05c9c8b"],
  ["fetchUintArray(string,string,uint8)", "0xa426dedc"],
  ["ExtractString(string,string,string[],string,string,bool,uint8,uint8)", "0xc2dd1a7a"],
  [
    "ExtractANumber(string,string,uint256,uint256,string,string,bool,uint8,uint8)",
    "0x2623e955",
  ],
]);

const expectedTopics = new Map([
  ["AgentResult(uint256,bytes,bool,uint8)", "0x471054ab5f4db6ed02b39338029dd5ad49314b47f4f4c0824d5ff31d17df2f26"],
  ["RequestFinalized(uint256,uint8)", "0x65db1ef5b3bcd84fe4fb8dbbe1cadc9fe6643bb261ab2e01d65c281c3d466af2"],
]);

let failed = false;
for (const [signature, selector] of expected) {
  const actual = toFunctionSelector(signature);
  if (actual !== selector) {
    console.error(`${signature}: expected ${selector}, got ${actual}`);
    failed = true;
  }
}

for (const [signature, topic] of expectedTopics) {
  const actual = keccak256(toBytes(signature));
  if (actual !== topic) {
    console.error(`${signature}: expected ${topic}, got ${actual}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("Selector checks passed.");
