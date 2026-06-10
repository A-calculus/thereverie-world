'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import gsap from 'gsap';
import { ArrowRight, Bot, Cpu, Zap } from 'lucide-react';
import { appRouteUrl, docsUrl, loginUrl } from '@/lib/shared/routes';

export default function Home() {
  const heroRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = new URL(window.location.href);
    if (current.searchParams.has('code')) {
      window.location.replace(appRouteUrl(`/auth/callback${current.search}`));
      return;
    }

    const ctx = gsap.context(() => {
      // Hero text animation
      gsap.fromTo(
        '.hero-text',
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, duration: 1, stagger: 0.2, ease: 'power3.out' }
      );

      // Cards animation
      gsap.fromTo(
        '.feature-card',
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, stagger: 0.15, ease: 'power2.out', delay: 0.6 }
      );
    }, heroRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={heroRef} className="flex-1 flex flex-col items-center justify-center p-4 min-h-[calc(100vh-4rem)]">
      {/* Hero Section */}
      <div ref={textRef} className="text-center max-w-4xl mx-auto mb-20 pt-20">
        <h1 className="hero-text text-5xl md:text-7xl font-bold mb-6 leading-tight">
          Build worlds that <span className="text-gradient">dream.</span>
        </h1>
        <p className="hero-text text-xl md:text-2xl text-text-muted mb-10 max-w-2xl mx-auto">
          The intelligence and infrastructure layer for autonomous on-chain systems on the Somnia blockchain.
        </p>
        <div className="hero-text flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link 
            href={loginUrl('/dashboard')} 
            className="px-8 py-4 rounded-xl bg-dream hover:bg-aurora text-void font-semibold transition-all duration-300 flex items-center gap-2 group"
          >
            Launch Builder
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link 
            href={docsUrl()} 
            className="px-8 py-4 rounded-xl glass-panel glass-panel-hover font-medium flex items-center gap-2"
          >
            Read the Docs
          </Link>
        </div>
      </div>

      {/* Features Showcase */}
      <div ref={cardsRef} className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto w-full mb-20">
        <div className="feature-card glass-panel p-8 glass-panel-hover group">
          <div className="w-12 h-12 rounded-lg bg-teal/10 flex items-center justify-center mb-6 text-teal group-hover:scale-110 transition-transform">
            <Zap className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-semibold mb-3 font-display">Reactivity Triggers</h3>
          <p className="text-text-muted">
            Native pub/sub events. Contracts react to external data and internal state changes without external keepers.
          </p>
        </div>
        
        <div className="feature-card glass-panel p-8 glass-panel-hover group">
          <div className="w-12 h-12 rounded-lg bg-dream/10 flex items-center justify-center mb-6 text-dream group-hover:scale-110 transition-transform">
            <Bot className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-semibold mb-3 font-display">LLM Inference</h3>
          <p className="text-text-muted">
            On-chain AI agents powered by Qwen3. Consensus-verified results guaranteed by validators.
          </p>
        </div>
        
        <div className="feature-card glass-panel p-8 glass-panel-hover group">
          <div className="w-12 h-12 rounded-lg bg-aurora/10 flex items-center justify-center mb-6 text-aurora group-hover:scale-110 transition-transform">
            <Cpu className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-semibold mb-3 font-display">Web Parsing</h3>
          <p className="text-text-muted">
            Agents that can browse the web, extract data, and deliver parsed JSON directly to your smart contracts.
          </p>
        </div>
      </div>
      
      {/* Testnet Badge */}
      <div className="hero-text mt-auto pb-8">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-teal/30 bg-teal/5 text-sm text-teal font-medium">
          <span className="w-2 h-2 rounded-full bg-teal animate-pulse"></span>
          Live on Somnia Testnet
        </div>
      </div>
    </div>
  );
}
