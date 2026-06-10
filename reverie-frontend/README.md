# REVERIE Frontend

> **We are building the intelligence and infrastructure layer for autonomous on-chain systems.** It is the Operating system that makes it possible to run reactive, AI-powered logic entirely on-chain, not just for virtual worlds, but for any system that needs autonomous, consensus-verified decision-making. REVERIE moves this logic fully on-chain, leveraging Somnia’s native L1 architecture.

This repository (`reverie-frontend`) contains the **consumer platform** for the REVERIE ecosystem.

## Our Deliverable is Twofold

1. **`@worldframe/sdk`**: The underlying TypeScript infrastructure allowing developers direct, type-safe access to Somnia's Native L1 Agents plus four custom REVERIE agents to connect smart contracts to AI reasoning through Somnia's network.
2. **REVERIE (This Frontend)**: A no-code frontend platform where anyone can build autonomous, self-sustaining systems integrated with real-world data feeds, zero smart contract coding required. Configure triggers, connect data feeds, define agent behaviors, deploy to testnet with one click.

---

## What We Are Building & Why

Today, every "intelligent" blockchain application has the same architectural flaw: Intelligence (from AI reasoning, Real-world data feeds, Reactive triggers, including World logic) **Lives Off-Chain**.

1. **Virtual worlds**: NPCs run on game servers, not on-chain.
2. **DeFi automation**: "Smart" trading bots run in centralized infrastructure.
3. **AI experiences**: LLM inference happens on AI's servers, not verified on-chain.
4. **Reactive systems**: Monitoring and triggering happens via Chainlink keepers.

**The consequence:** You're trusting a company's server logs instead of cryptographic consensus.

We are building the operating system for autonomous on-chain intelligence. REVERIE lets developers run AI-powered, reactive logic without managing centralized infrastructure.

**The difference:** Lambda runs in Amazon's data centers. REVERIE runs on Somnia's L1, verified by validator consensus.

---

## Platform Features

The REVERIE consumer platform is the accessible interface for everyone (especially the 92% that doesn't need to write code to use the product/service).

- **Visual no-code builder**: Connect zones, factions, agents, and data feeds visually.
- **One-click deployment to testnet**: Compile your world into a manifest and deploy it to Somnia without writing Solidity.
- **Live event monitoring with "Proof of Thought" receipts**: Every decision produces a cryptographic receipt proving the AI's logic was consensus-verified.
- **Template marketplace**: Deploy instantly from pre-configured templates (fantasy, cyberpunk, DeFi automation, custom).
- **Wallet-based auth**: Connect via EIP-1193 and get a shared `reverie-session` cookie across all subdomains.

Together with the SDK, we make it possible to deploy autonomous systems that:
1. **React to real-world data**
2. **Make consensus-verified decisions**
3. **Persist indefinitely on-chain**
4. **Run without human intervention**
5. **Provide cryptographic proof of every decision**

### Why This Matters

Once deployed and funded, a REVERIE system is a self-sustaining on-chain entity. 

The use cases span DeFi Automation, gaming, social tokens mechanics, AI powered NFTs Evolution, DAOs, prediction markets, insurance, supply chain sentiment analysis, virtual worlds — anywhere intelligence and reactivity create value.

---

## Local Development

The frontend supports Next.js 16 App Router, React 19, TypeScript, and Tailwind CSS v4. Database persistence is handled via Supabase.

### Setup

**Use `lvh.me:3000` instead of `localhost:3000`.** The `lvh.me` domain resolves to `127.0.0.1` and supports wildcard subdomains natively. This is strictly required for the shared-cookie subdomain authentication to work properly across the platform.

```bash
cd reverie-frontend
npm install
cp .env.example .env   # Fill in Supabase, GitHub OAuth, and Somnia RPC details
npm run dev            # Starts on http://lvh.me:3000
```

### URL Structure (Subdomain Mode)

Once running locally, the platform spans multiple subdomains:
- `http://lvh.me:3000` - Landing and Dashboard
- `http://apps.lvh.me:3000` - World creation and management
- `http://agents.lvh.me:3000` - Agent wizard and testing
- `http://marketplace.lvh.me:3000` - Official templates
- `http://docs.lvh.me:3000` - Full documentation suite
- `http://{slug}.app.lvh.me:3000` - Live world runtime monitoring

---

## Environment Variables

> **Security Note:** Never add `BUILDER_PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY` to the frontend environment. All blockchain transactions must be signed through the user's connected browser wallet.

```bash
# Core Platform
NEXT_PUBLIC_REVERIE_BASE_URL=https://thereverie.world
NEXT_PUBLIC_REVERIE_ROUTING_MODE=subdomain    # Use 'path' for free Vercel deployments

# Supabase Auth & Database
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Somnia Infrastructure
NEXT_PUBLIC_SOMNIA_TESTNET_RPC=https://api.infra.testnet.somnia.network/
NEXT_PUBLIC_REVERIE_REGISTRY_ADDRESS=0x...
SOMNIA_AGENT_RECEIPTS_BASE_URL=https://receipts.testnet.agents.somnia.host
```

---

## E2E Testing & Verification

Run this verification loop before pushing changes:

```bash
rm -rf .next
npm run lint          # ESLint with Next.js rules
npm run build         # Production build check
npm run dev &         # Run in background
npm run test:e2e      # Run Playwright suite
```

The Playwright suite covers protected routes, agent tests, official templates, builder config, and the runtime state reconciliation loop.
