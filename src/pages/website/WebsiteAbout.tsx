import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';
import { Lightbulb, Trophy, Handshake, ShieldCheck, ArrowRight, TrendingUp, Brain, Hotel, Users, Star, CalendarDays } from 'lucide-react';
import { useWebsiteLang } from '@/contexts/WebsiteLanguageContext';
import WebsiteLayout from './WebsiteLayout';

function FadeIn({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 28 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const valueIcons = [Lightbulb, Trophy, Handshake, ShieldCheck];
const serviceIcons = [TrendingUp, Brain, Hotel, Users, Star, CalendarDays];

export default function WebsiteAbout() {
  const { t } = useWebsiteLang();

  const values = [
    { title: t.about.v1_title, desc: t.about.v1_desc },
    { title: t.about.v2_title, desc: t.about.v2_desc },
    { title: t.about.v3_title, desc: t.about.v3_desc },
    { title: t.about.v4_title, desc: t.about.v4_desc },
  ];

  const services = [
    { title: t.services.s1_title, desc: t.services.s1_desc },
    { title: t.services.s2_title, desc: t.services.s2_desc },
    { title: t.services.s3_title, desc: t.services.s3_desc },
    { title: t.services.s4_title, desc: t.services.s4_desc },
    { title: t.services.s5_title, desc: t.services.s5_desc },
    { title: t.services.s6_title, desc: t.services.s6_desc },
  ];

  return (
    <WebsiteLayout>
      {/* Hero */}
      <section className="relative bg-[#0d1b2a] pt-32 pb-24 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/3 w-72 h-72 bg-[#c9a84c]/8 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-56 h-56 bg-[#c9a84c]/5 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-block text-[#c9a84c] text-xs tracking-[0.4em] uppercase font-medium mb-6 border border-[#c9a84c]/30 px-4 py-1.5 rounded-full"
          >
            About RD Hotels
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="text-4xl sm:text-5xl md:text-6xl font-bold text-white leading-[1.1] mb-6"
          >
            {t.about.title}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="text-xl text-white/50"
          >
            {t.about.subtitle}
          </motion.p>
        </div>
      </section>

      {/* Story */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <span className="text-[#c9a84c] text-xs tracking-[0.35em] uppercase font-medium">{t.about.story_title}</span>
              <h2 className="text-3xl sm:text-4xl font-bold text-[#0d1b2a] mt-3 mb-6 leading-tight">
                It all starts with an idea.
              </h2>
              <p className="text-[#0d1b2a]/60 leading-relaxed mb-5 text-lg">
                {t.about.story_p1}
              </p>
              <p className="text-[#0d1b2a]/60 leading-relaxed text-lg">
                {t.about.story_p2}
              </p>
            </FadeIn>

            {/* Mission & Vision cards */}
            <div className="space-y-5">
              <FadeIn delay={0.1}>
                <div className="bg-[#0d1b2a] rounded-2xl p-8">
                  <h3 className="text-[#c9a84c] font-bold text-sm tracking-widest uppercase mb-3">
                    {t.about.mission_title}
                  </h3>
                  <p className="text-white/70 leading-relaxed">{t.about.mission_text}</p>
                </div>
              </FadeIn>
              <FadeIn delay={0.2}>
                <div className="bg-[#f8f6f2] rounded-2xl p-8 border border-[#e8e0d0]">
                  <h3 className="text-[#0d1b2a] font-bold text-sm tracking-widest uppercase mb-3">
                    {t.about.vision_title}
                  </h3>
                  <p className="text-[#0d1b2a]/60 leading-relaxed">{t.about.vision_text}</p>
                </div>
              </FadeIn>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-24 bg-[#f8f6f2]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="text-center mb-14">
            <span className="text-[#c9a84c] text-xs tracking-[0.35em] uppercase font-medium">Core Values</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0d1b2a] mt-3">{t.about.values_title}</h2>
          </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {values.map((value, i) => {
              const Icon = valueIcons[i];
              return (
                <FadeIn key={i} delay={i * 0.1}>
                  <div className="bg-white rounded-2xl p-7 h-full hover:shadow-lg transition-shadow">
                    <div className="w-12 h-12 bg-[#0d1b2a] rounded-xl flex items-center justify-center mb-5">
                      <Icon size={22} className="text-[#c9a84c]" />
                    </div>
                    <h3 className="font-bold text-[#0d1b2a] text-lg mb-3">{value.title}</h3>
                    <p className="text-[#0d1b2a]/55 text-sm leading-relaxed">{value.desc}</p>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* Services Detail */}
      <section className="py-24 bg-[#0d1b2a]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="text-center mb-14">
            <span className="text-[#c9a84c] text-xs tracking-[0.35em] uppercase font-medium">What We Offer</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mt-3">{t.services.section_title}</h2>
          </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {services.map((service, i) => {
              const Icon = serviceIcons[i];
              return (
                <FadeIn key={i} delay={i * 0.08}>
                  <div className="flex gap-5 bg-white/5 hover:bg-white/8 border border-white/10 rounded-2xl p-6 transition-colors h-full">
                    <div className="shrink-0 w-10 h-10 bg-[#c9a84c]/15 rounded-xl flex items-center justify-center">
                      <Icon size={18} className="text-[#c9a84c]" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold mb-2">{service.title}</h3>
                      <p className="text-white/50 text-sm leading-relaxed">{service.desc}</p>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-white">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <FadeIn>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0d1b2a] mb-4">{t.cta.title}</h2>
            <p className="text-[#0d1b2a]/50 mb-8 text-lg">{t.cta.subtitle}</p>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 bg-[#c9a84c] hover:bg-[#b8973b] text-[#0d1b2a] font-semibold px-8 py-4 rounded-xl transition-all hover:scale-105"
            >
              {t.cta.button} <ArrowRight size={18} />
            </Link>
          </FadeIn>
        </div>
      </section>
    </WebsiteLayout>
  );
}
