import React, { useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';
import {
  TrendingUp, Brain, Hotel, Users, Star, CalendarDays,
  Award, Cpu, MapPin, Handshake, ArrowRight, ChevronRight,
  ExternalLink
} from 'lucide-react';
import { useWebsiteLang } from '@/contexts/WebsiteLanguageContext';
import WebsiteLayout from './WebsiteLayout';

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.12 } },
};

function FadeIn({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      variants={{ hidden: { opacity: 0, y: 28 }, visible: { opacity: 1, y: 0, transition: { duration: 0.6, delay, ease: 'easeOut' } } }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const hotels = [
  { name: 'Hotel Gozsdu Court', url: 'https://gozsducourt.com', desc: 'Boutique hotel in the vibrant Gozsdu yard' },
  { name: 'Hotel Memories Budapest', url: 'https://hotel-memories-budapest.com', desc: 'Creating memories in the heart of Budapest' },
  { name: 'Hotel Mika Downtown', url: 'https://hotelmika.com', desc: 'Design hotel with a secret museum' },
  { name: 'Mitico Budapest', url: 'https://mitico.hu', desc: 'Italian spirit in the Hungarian capital' },
  { name: 'Levante Budapest', url: 'https://levantebudapest.hu', desc: 'Mediterranean elegance in Budapest' },
  { name: 'Hotel Ottofiori Budapest', url: 'https://ottofiori.hu', desc: 'Floral luxury in the city center' },
];

const serviceIcons = [TrendingUp, Brain, Hotel, Users, Star, CalendarDays];
const whyIcons = [Award, Cpu, MapPin, Handshake];

export default function WebsiteHome() {
  const { t } = useWebsiteLang();

  useEffect(() => {
    document.title = `RD Hotels | ${t.hero.subtitle}`;
  }, [t]);

  const servicesRef = useRef(null);
  const servicesInView = useInView(servicesRef, { once: true, margin: '-80px' });

  const services = [
    { title: t.services.s1_title, desc: t.services.s1_desc },
    { title: t.services.s2_title, desc: t.services.s2_desc },
    { title: t.services.s3_title, desc: t.services.s3_desc },
    { title: t.services.s4_title, desc: t.services.s4_desc },
    { title: t.services.s5_title, desc: t.services.s5_desc },
    { title: t.services.s6_title, desc: t.services.s6_desc },
  ];

  const whyPoints = [
    { title: t.why.w1_title, desc: t.why.w1_desc },
    { title: t.why.w2_title, desc: t.why.w2_desc },
    { title: t.why.w3_title, desc: t.why.w3_desc },
    { title: t.why.w4_title, desc: t.why.w4_desc },
  ];

  return (
    <WebsiteLayout>
      {/* ── Hero ── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#0d1b2a]">
        {/* Decorative background */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#c9a84c]/8 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-[#c9a84c]/5 rounded-full blur-3xl" />
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage: `repeating-linear-gradient(
                0deg, transparent, transparent 59px, rgba(201,168,76,0.3) 59px, rgba(201,168,76,0.3) 60px
              ), repeating-linear-gradient(
                90deg, transparent, transparent 59px, rgba(201,168,76,0.3) 59px, rgba(201,168,76,0.3) 60px
              )`,
            }}
          />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center pt-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <span className="inline-block text-[#c9a84c] text-xs tracking-[0.4em] uppercase font-medium mb-6 border border-[#c9a84c]/30 px-4 py-1.5 rounded-full">
              Budapest, Hungary
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.35 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white leading-[1.1] tracking-tight mb-4"
          >
            {t.hero.title}
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="w-24 h-0.5 bg-[#c9a84c] mx-auto my-6"
          />

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.7 }}
            className="text-lg sm:text-xl text-white/60 max-w-2xl mx-auto leading-relaxed"
          >
            {t.hero.description}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.9 }}
            className="flex flex-col sm:flex-row gap-4 justify-center mt-10"
          >
            <Link
              to="/about-us"
              className="inline-flex items-center justify-center gap-2 bg-[#c9a84c] hover:bg-[#b8973b] text-[#0d1b2a] font-semibold px-8 py-4 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg shadow-[#c9a84c]/20"
            >
              {t.hero.cta_primary}
              <ArrowRight size={18} />
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center justify-center gap-2 border border-white/20 hover:border-white/40 text-white font-medium px-8 py-4 rounded-xl transition-all duration-200 hover:bg-white/5 backdrop-blur-sm"
            >
              {t.hero.cta_secondary}
            </Link>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 1.1 }}
            className="mt-20 grid grid-cols-3 gap-8 max-w-lg mx-auto border-t border-white/10 pt-10"
          >
            {[
              { value: '6+', label: 'Hotels' },
              { value: '10+', label: 'Years' },
              { value: '100%', label: 'Hungarian' },
            ].map(stat => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-bold text-[#c9a84c]">{stat.value}</div>
                <div className="text-xs text-white/40 mt-1 tracking-widest uppercase">{stat.label}</div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        >
          <div className="w-px h-12 bg-gradient-to-b from-[#c9a84c]/60 to-transparent animate-pulse" />
        </motion.div>
      </section>

      {/* ── Services ── */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="text-center mb-16">
            <span className="text-[#c9a84c] text-xs tracking-[0.35em] uppercase font-medium">Our Expertise</span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[#0d1b2a] mt-3 mb-4">
              {t.services.section_title}
            </h2>
            <p className="text-[#0d1b2a]/50 max-w-2xl mx-auto text-lg">{t.services.section_subtitle}</p>
          </FadeIn>

          <motion.div
            ref={servicesRef}
            initial="hidden"
            animate={servicesInView ? 'visible' : 'hidden'}
            variants={stagger}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {services.map((service, i) => {
              const Icon = serviceIcons[i];
              return (
                <motion.div
                  key={i}
                  variants={fadeUp}
                  className="group relative bg-[#f8f6f2] hover:bg-[#0d1b2a] rounded-2xl p-8 transition-all duration-300 cursor-default overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#c9a84c]/5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:bg-[#c9a84c]/10 transition-all duration-300" />
                  <div className="relative">
                    <div className="w-12 h-12 bg-[#c9a84c]/15 group-hover:bg-[#c9a84c]/20 rounded-xl flex items-center justify-center mb-6 transition-colors">
                      <Icon size={22} className="text-[#c9a84c]" />
                    </div>
                    <h3 className="text-lg font-bold text-[#0d1b2a] group-hover:text-white mb-3 transition-colors">
                      {service.title}
                    </h3>
                    <p className="text-sm text-[#0d1b2a]/55 group-hover:text-white/60 leading-relaxed transition-colors">
                      {service.desc}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* ── Hotel Portfolio ── */}
      <section className="py-24 bg-[#0d1b2a]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="text-center mb-16">
            <span className="text-[#c9a84c] text-xs tracking-[0.35em] uppercase font-medium">Portfolio</span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mt-3 mb-4">
              {t.portfolio.section_title}
            </h2>
            <p className="text-white/40 max-w-xl mx-auto text-lg">{t.portfolio.section_subtitle}</p>
          </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {hotels.map((hotel, i) => (
              <FadeIn key={hotel.name} delay={i * 0.07}>
                <a
                  href={hotel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block bg-white/5 hover:bg-[#c9a84c]/10 border border-white/10 hover:border-[#c9a84c]/30 rounded-2xl p-7 transition-all duration-300"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 bg-[#c9a84c]/15 rounded-xl flex items-center justify-center">
                      <Hotel size={18} className="text-[#c9a84c]" />
                    </div>
                    <ExternalLink size={14} className="text-white/20 group-hover:text-[#c9a84c] transition-colors mt-1" />
                  </div>
                  <h3 className="text-white font-semibold mb-2 group-hover:text-[#c9a84c] transition-colors">
                    {hotel.name}
                  </h3>
                  <p className="text-white/40 text-sm">{hotel.desc}</p>
                </a>
              </FadeIn>
            ))}
          </div>

          {/* Venues */}
          <FadeIn className="mt-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <a
                href="https://rumbachspace.hu"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 bg-white/5 hover:bg-[#c9a84c]/10 border border-white/10 hover:border-[#c9a84c]/30 rounded-2xl p-6 transition-all duration-300"
              >
                <CalendarDays size={20} className="text-[#c9a84c] shrink-0" />
                <div>
                  <div className="text-white font-medium group-hover:text-[#c9a84c] transition-colors">Rumbachspace Events & Conferences</div>
                  <div className="text-white/40 text-sm mt-0.5">Events · Conferences · Private dining</div>
                </div>
                <ExternalLink size={14} className="text-white/20 group-hover:text-[#c9a84c] transition-colors ml-auto shrink-0" />
              </a>
              <a
                href="https://hotelmika.com/museum"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 bg-white/5 hover:bg-[#c9a84c]/10 border border-white/10 hover:border-[#c9a84c]/30 rounded-2xl p-6 transition-all duration-300"
              >
                <Star size={20} className="text-[#c9a84c] shrink-0" />
                <div>
                  <div className="text-white font-medium group-hover:text-[#c9a84c] transition-colors">Mika Tivadar Secret Museum</div>
                  <div className="text-white/40 text-sm mt-0.5">Unique cultural attraction · Budapest</div>
                </div>
                <ExternalLink size={14} className="text-white/20 group-hover:text-[#c9a84c] transition-colors ml-auto shrink-0" />
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Why Choose Us ── */}
      <section className="py-24 bg-[#f8f6f2]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <span className="text-[#c9a84c] text-xs tracking-[0.35em] uppercase font-medium">Why RD Hotels</span>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[#0d1b2a] mt-3 mb-4 leading-tight">
                {t.why.section_title}
              </h2>
              <p className="text-[#0d1b2a]/50 text-lg leading-relaxed mb-8">{t.why.section_subtitle}</p>
              <Link
                to="/about-us"
                className="inline-flex items-center gap-2 text-[#c9a84c] font-medium hover:gap-3 transition-all"
              >
                Learn more about us <ChevronRight size={16} />
              </Link>
            </FadeIn>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {whyPoints.map((point, i) => {
                const Icon = whyIcons[i];
                return (
                  <FadeIn key={i} delay={i * 0.1}>
                    <div className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                      <div className="w-11 h-11 bg-[#0d1b2a] rounded-xl flex items-center justify-center mb-4">
                        <Icon size={20} className="text-[#c9a84c]" />
                      </div>
                      <h3 className="font-bold text-[#0d1b2a] mb-2">{point.title}</h3>
                      <p className="text-sm text-[#0d1b2a]/55 leading-relaxed">{point.desc}</p>
                    </div>
                  </FadeIn>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <section className="py-24 bg-[#c9a84c] relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-0 w-64 h-64 bg-white/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#0d1b2a]/10 rounded-full translate-x-1/3 translate-y-1/3" />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <FadeIn>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[#0d1b2a] mb-4 leading-tight">
              {t.cta.title}
            </h2>
            <p className="text-[#0d1b2a]/70 text-lg mb-10 max-w-2xl mx-auto leading-relaxed">
              {t.cta.subtitle}
            </p>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 bg-[#0d1b2a] hover:bg-[#1a2f45] text-white font-semibold px-10 py-4 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 shadow-xl"
            >
              {t.cta.button}
              <ArrowRight size={18} />
            </Link>
          </FadeIn>
        </div>
      </section>
    </WebsiteLayout>
  );
}
