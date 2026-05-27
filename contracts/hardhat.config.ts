import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import * as dotenv from "dotenv";
import type { HardhatUserConfig } from "hardhat/types/config";

dotenv.config();

const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;

const config: HardhatUserConfig = {
  plugins: [hardhatEthers, hardhatViem],
  solidity: {
    version: "0.8.30",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    somniaTestnet: {
      type: "http",
      url: process.env.SOMNIA_RPC_URL ?? "https://api.infra.testnet.somnia.network/",
      chainId: 50312,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};

export default defineConfig(config);
