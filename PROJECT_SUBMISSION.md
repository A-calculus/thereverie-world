# REVERIE — The Operating System for Autonomous On-Chain Intelligence

> **We are building the intelligence and infrastructure layer for autonomous on-chain systems.** REVERIE is the operating system that makes it possible to run reactive, AI-powered logic entirely on-chain — not just for virtual worlds, but for any system that needs autonomous, consensus-verified decision-making. By leveraging Somnia’s native L1 architecture, REVERIE moves the intelligence layer fully on-chain.

**Our deliverable is twofold:**
1. **`@worldframe/sdk`**: The underlying TypeScript infrastructure allowing developers direct, type-safe access to Somnia's Native L1 Agents plus four custom REVERIE agents to connect smart contracts to AI reasoning through Somnia's network.
2. **REVERIE**: A no-code frontend platform where anyone can build autonomous, self-sustaining systems integrated with real-world data feeds — zero smart contract coding required. Configure triggers, connect data feeds, define agent behaviors, and deploy to testnet with one click.

---

## The Problem: Intelligence Lives Off-Chain

Today, every "intelligent" blockchain application has the same architectural flaw: the intelligence layer — including AI reasoning, real-world data feeds, reactive triggers, and world logic — lives off-chain.

1. **Virtual worlds**: NPCs run on centralized game servers, not on-chain.
2. **DeFi automation**: "Smart" trading bots run in centralized infrastructure.
3. **AI experiences**: LLM inference happens on private AI company servers, unverified on-chain.
4. **Reactive systems**: Monitoring and triggering depend on external systems like Chainlink keepers.

**The consequence:** You're trusting a company's server logs instead of cryptographic consensus. There is no cryptographic proof that the AI actually made the decision it claims to have made, or that the logic wasn't tampered with mid-run.

---

## The Solution: On-Chain Operating System

We are building the operating system for autonomous on-chain intelligence. REVERIE lets developers run AI-powered, reactive logic without managing centralized infrastructure.

**The difference:** Lambda runs in Amazon's data centers. REVERIE runs on Somnia's L1, verified by validator consensus.

### 1. `@worldframe/sdk` (The Infrastructure Layer)
The pipes and plumbing for developers:
- **Seven agents**: 3 native Somnia primitives (LLM, JSON API, Web Parse) + 4 custom REVERIE agents.
- **Two execution lanes**: SDK-based (browser/testing) and fully autonomous on-chain execution.
- **Hybrid reactivity system**: Off-chain polling combined with on-chain subscriptions via Somnia's Reactivity Precompile.
- **Embedded `SomniaAgentKit`**: Configured for validator consensus and automatic STT deposit management.
- **Full TypeScript support**: Type safety and runtime validation out of the box.

### 2. REVERIE (The Consumer Platform)
The accessible, no-code interface for everyone:
- **Visual no-code builder**: Connect zones, factions, agents, and triggers via a drag-and-drop UI.
- **One-click deployment**: Compiles configuration into a deterministic manifest deployed to the testnet.
- **Live event monitoring**: Inspect real-time actions and view "Proof of Thought" cryptographic receipts.
- **Template marketplace**: Start instantly with production-ready templates (e.g., fantasy kingdoms, cyberpunk markets, custom).

---

## Why This Matters

Together, the SDK and platform make it possible to deploy autonomous systems that:
1. **React to real-world data** instantly
2. **Make consensus-verified decisions** without trusted third parties
3. **Persist indefinitely on-chain**
4. **Run without human intervention**
5. **Provide cryptographic proof** of every decision through an auditable receipt

Once deployed and funded, a REVERIE system is a self-sustaining on-chain entity.

### Use Cases
The potential spans far beyond simple games. Use REVERIE for:
- DeFi Automation and Crisis Hedging
- Dynamic Gaming and Living Worlds
- Social Token Mechanics
- AI-Powered NFT Evolution
- DAOs and Governance Resolvers
- Prediction Markets
- Parametric Insurance Settlements
- Supply Chain Sentiment Analysis

...and anywhere else where verifiable intelligence and reactivity create value.

---

## Technical Implementation (Phase 1 & Phase 2)

REVERIE is a fully delivered suite encompassing both smart contracts and consumer platform.

| Component | Technology | Purpose |
|-----------|-----------|---------|
| `contracts/` | Solidity | On-chain execution. `ReverieRegistry`, `ReverieWorldInstance`, `CallbackReceiver`, and Reactivity libraries. |
| `sdk/` | TypeScript, viem | `@worldframe/sdk`. Direct access to agents, world deployment, trigger management, and WS events. |
| `reverie-frontend/` | Next.js 16, Supabase, Tailwind | The no-code visual builder, marketplace, dashboard, and documentation hub. |

### How a Decision is Made (Proof of Thought)
When a REVERIE system needs to act (e.g., weather data hits a threshold):
1. **Trigger fires**: Reactivity triggers the on-chain contract.
2. **Agent requested**: The world contract requests an LLM decision, funding the deposit with its STT balance.
3. **Consensus execution**: Independent Somnia validators process the LLM request.
4. **State updated**: The contract's callback receives the consensus result and updates world state.
5. **Receipt generated**: A cryptographic receipt is published, proving exactly how the decision was made.

This guarantees that the logic governing your application is as trustless and verifiable as the tokens living inside it.

---

## Quick Links
- **[reverie-frontend/README.md](reverie-frontend/README.md)**: Details on the Next.js platform architecture and local setup.
- **[Getting Started Docs](reverie-frontend/content/docs/getting-started.md)**: Full platform user guide.
- **[worldframe-sdk-spec.md](worldframe-sdk-spec.md)**: Deep dive into the TypeScript infrastructure layer.
