import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { useWebsiteLang } from '@/contexts/WebsiteLanguageContext';
import WebsiteLayout from './WebsiteLayout';

function FadeIn({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface TeamMember {
  name: string;
  title: string;
  initials: string;
  color: string;
}

const directors: TeamMember[] = [
  { name: 'Batuska Richárd', title: 'Director', initials: 'BR', color: '#c9a84c' },
  { name: 'Kalaitzidis Dimitris', title: 'Director', initials: 'KD', color: '#c9a84c' },
];

const management: TeamMember[] = [
  { name: 'Anuruddha Dharmasena', title: 'Business Analyst & Head of Sales & Marketing', initials: 'AD', color: '#2563eb' },
  { name: 'Puhl Andrea', title: 'Finance & Control Manager', initials: 'PA', color: '#7c3aed' },
  { name: 'Horváth Nóra', title: 'Sales & Reservations Manager', initials: 'HN', color: '#059669' },
  { name: 'Szántó Petra', title: 'Human Resource Manager', initials: 'SP', color: '#dc2626' },
  { name: 'Staszkiv Gergely', title: 'Food & Beverage Manager', initials: 'SG', color: '#d97706' },
  { name: 'Júlia Végh', title: 'Visual Artist & Interior Designer', initials: 'VJ', color: '#db2777' },
];

const frontOffice: TeamMember[] = [
  { name: 'Antal Klaudia', title: 'Front Office Manager', initials: 'AK', color: '#0891b2' },
  { name: 'Lengyel Petra', title: 'Front Office Manager', initials: 'LP', color: '#0891b2' },
];

function MemberCard({ member, index }: { member: TeamMember; index: number }) {
  return (
    <FadeIn delay={index * 0.07}>
      <div className="group bg-white rounded-2xl p-6 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 text-center">
        {/* Avatar */}
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white text-xl font-bold shadow-sm"
          style={{ backgroundColor: member.color }}
        >
          {member.initials}
        </div>
        <h3 className="font-bold text-[#0d1b2a] mb-1.5">{member.name}</h3>
        <p className="text-sm text-[#0d1b2a]/50 leading-snug">{member.title}</p>
      </div>
    </FadeIn>
  );
}

export default function WebsiteTeam() {
  const { t } = useWebsiteLang();

  return (
    <WebsiteLayout>
      {/* Hero */}
      <section className="relative bg-[#0d1b2a] pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/3 w-72 h-72 bg-[#c9a84c]/8 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-block text-[#c9a84c] text-xs tracking-[0.4em] uppercase font-medium mb-6 border border-[#c9a84c]/30 px-4 py-1.5 rounded-full"
          >
            Our People
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-5"
          >
            {t.team.title}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-xl text-white/50"
          >
            {t.team.subtitle}
          </motion.p>
        </div>
      </section>

      {/* Quote */}
      <section className="py-16 bg-[#c9a84c]">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <FadeIn>
            <blockquote className="text-2xl sm:text-3xl font-bold text-[#0d1b2a] leading-tight mb-4">
              "{t.team.quote}"
            </blockquote>
            <p className="text-[#0d1b2a]/60 font-medium">— {t.team.quote_author}</p>
          </FadeIn>
        </div>
      </section>

      {/* Directors */}
      <section className="py-20 bg-[#f8f6f2]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-10">
            <div className="flex items-center gap-4">
              <div className="w-1 h-8 bg-[#c9a84c] rounded-full" />
              <h2 className="text-2xl font-bold text-[#0d1b2a]">{t.team.directors}</h2>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-lg">
            {directors.map((member, i) => (
              <MemberCard key={member.name} member={member} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* Management */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-10">
            <div className="flex items-center gap-4">
              <div className="w-1 h-8 bg-[#0d1b2a] rounded-full" />
              <h2 className="text-2xl font-bold text-[#0d1b2a]">{t.team.management}</h2>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {management.map((member, i) => (
              <MemberCard key={member.name} member={member} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* Front Office */}
      <section className="py-20 bg-[#f8f6f2]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-10">
            <div className="flex items-center gap-4">
              <div className="w-1 h-8 bg-[#0d1b2a] rounded-full" />
              <h2 className="text-2xl font-bold text-[#0d1b2a]">{t.team.front_office}</h2>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-lg">
            {frontOffice.map((member, i) => (
              <MemberCard key={member.name} member={member} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* Join CTA */}
      <section className="py-20 bg-[#0d1b2a]">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <FadeIn>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t.careers.title}</h2>
            <p className="text-white/50 mb-8 text-lg">{t.careers.description}</p>
            <a
              href="/join-our-team"
              className="inline-flex items-center gap-2 bg-[#c9a84c] hover:bg-[#b8973b] text-[#0d1b2a] font-semibold px-8 py-4 rounded-xl transition-all hover:scale-105"
            >
              {t.nav.careers}
            </a>
          </FadeIn>
        </div>
      </section>
    </WebsiteLayout>
  );
}
