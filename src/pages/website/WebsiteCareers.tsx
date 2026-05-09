import React, { useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { Heart, Zap, Users, Globe2, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { useWebsiteLang } from '@/contexts/WebsiteLanguageContext';
import { supabase } from '@/integrations/supabase/client';
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

const culturePoints = [
  { icon: Heart, title: 'Passion-Driven', desc: 'We pour heart into every guest interaction and every hotel we manage.' },
  { icon: Zap, title: 'Fast-Paced Growth', desc: 'Rapid development opportunities for ambitious hospitality professionals.' },
  { icon: Users, title: 'Diverse Team', desc: 'A multicultural team with international backgrounds and local knowledge.' },
  { icon: Globe2, title: 'International Reach', desc: 'Work with partners and guests from all over Central Europe and beyond.' },
];

export default function WebsiteCareers() {
  const { t, language } = useWebsiteLang();
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', position: '', about: '' });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.email.trim()) return;
    setSubmitting(true);
    setError('');

    const { error: dbError } = await supabase.from('website_leads').insert({
      lead_type: 'career',
      full_name: `${form.first_name} ${form.last_name}`.trim(),
      email: form.email,
      message: form.about || null,
      position: form.position || null,
      language,
    });

    setSubmitting(false);
    if (dbError) {
      setError('Something went wrong. Please try again or email us directly.');
    } else {
      setSuccess(true);
      setForm({ first_name: '', last_name: '', email: '', position: '', about: '' });
    }
  };

  const inputClass = 'w-full bg-white border border-[#e5e0d8] rounded-xl px-4 py-3.5 text-[#0d1b2a] placeholder-[#0d1b2a]/30 text-sm focus:outline-none focus:border-[#c9a84c] focus:ring-2 focus:ring-[#c9a84c]/20 transition-all';

  return (
    <WebsiteLayout>
      {/* Hero */}
      <section className="relative bg-[#0d1b2a] pt-32 pb-24 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/3 left-1/4 w-72 h-72 bg-[#c9a84c]/8 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/3 w-56 h-56 bg-[#c9a84c]/5 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-block text-[#c9a84c] text-xs tracking-[0.4em] uppercase font-medium mb-6 border border-[#c9a84c]/30 px-4 py-1.5 rounded-full"
          >
            Careers
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-5"
          >
            {t.careers.title}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-xl text-white/50 max-w-2xl mx-auto"
          >
            {t.careers.description}
          </motion.p>
        </div>
      </section>

      {/* Culture Section */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <span className="text-[#c9a84c] text-xs tracking-[0.35em] uppercase font-medium">{t.careers.culture_title}</span>
              <h2 className="text-3xl sm:text-4xl font-bold text-[#0d1b2a] mt-3 mb-5 leading-tight">
                {t.careers.culture_title}
              </h2>
              <p className="text-[#0d1b2a]/60 text-lg leading-relaxed mb-8">{t.careers.culture_text}</p>

              <div className="flex items-center gap-3 p-4 bg-[#f8f6f2] rounded-xl border border-[#e8e0d0]">
                <Mail size={18} className="text-[#c9a84c] shrink-0" />
                <div>
                  <p className="text-xs text-[#0d1b2a]/50 mb-1">{t.careers.email_note}</p>
                  <a href="mailto:cv@rdhotels.hu" className="text-[#c9a84c] font-semibold hover:underline text-sm">
                    cv@rdhotels.hu
                  </a>
                </div>
              </div>
            </FadeIn>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {culturePoints.map((point, i) => {
                const Icon = point.icon;
                return (
                  <FadeIn key={i} delay={i * 0.08}>
                    <div className="bg-[#f8f6f2] rounded-2xl p-6 hover:bg-[#0d1b2a] group transition-all duration-300">
                      <div className="w-10 h-10 bg-[#c9a84c]/15 group-hover:bg-[#c9a84c]/20 rounded-xl flex items-center justify-center mb-4 transition-colors">
                        <Icon size={18} className="text-[#c9a84c]" />
                      </div>
                      <h3 className="font-bold text-[#0d1b2a] group-hover:text-white mb-2 transition-colors">{point.title}</h3>
                      <p className="text-sm text-[#0d1b2a]/55 group-hover:text-white/60 leading-relaxed transition-colors">{point.desc}</p>
                    </div>
                  </FadeIn>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Application Form */}
      <section className="py-24 bg-[#f8f6f2]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <FadeIn className="text-center mb-12">
            <span className="text-[#c9a84c] text-xs tracking-[0.35em] uppercase font-medium">Apply</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0d1b2a] mt-3">{t.careers.form_title}</h2>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="bg-white rounded-3xl p-8 sm:p-10 shadow-sm">
              {success ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center gap-4 py-12 text-center"
                >
                  <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center">
                    <CheckCircle2 size={32} className="text-green-500" />
                  </div>
                  <p className="text-lg font-semibold text-[#0d1b2a]">{t.careers.success}</p>
                  <button
                    onClick={() => setSuccess(false)}
                    className="text-sm text-[#c9a84c] hover:underline mt-2"
                  >
                    Submit another application
                  </button>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-xs font-semibold text-[#0d1b2a]/60 uppercase tracking-widest mb-2">
                        {t.careers.field_first} *
                      </label>
                      <input
                        name="first_name"
                        value={form.first_name}
                        onChange={handleChange}
                        required
                        className={inputClass}
                        placeholder="First name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#0d1b2a]/60 uppercase tracking-widest mb-2">
                        {t.careers.field_last}
                      </label>
                      <input
                        name="last_name"
                        value={form.last_name}
                        onChange={handleChange}
                        className={inputClass}
                        placeholder="Last name"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#0d1b2a]/60 uppercase tracking-widest mb-2">
                      {t.careers.field_email} *
                    </label>
                    <input
                      name="email"
                      type="email"
                      value={form.email}
                      onChange={handleChange}
                      required
                      className={inputClass}
                      placeholder="your@email.com"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#0d1b2a]/60 uppercase tracking-widest mb-2">
                      {t.careers.field_position}
                    </label>
                    <input
                      name="position"
                      value={form.position}
                      onChange={handleChange}
                      className={inputClass}
                      placeholder="e.g. Front Office Manager, Revenue Analyst..."
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#0d1b2a]/60 uppercase tracking-widest mb-2">
                      {t.careers.field_about}
                    </label>
                    <textarea
                      name="about"
                      value={form.about}
                      onChange={handleChange}
                      rows={5}
                      className={inputClass + ' resize-none'}
                      placeholder="Tell us about your experience, skills, and why you'd love to join RD Hotels..."
                    />
                  </div>

                  {error && <p className="text-red-500 text-sm">{error}</p>}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full flex items-center justify-center gap-2 bg-[#0d1b2a] hover:bg-[#1a2f45] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99]"
                  >
                    {submitting ? (
                      <><Loader2 size={18} className="animate-spin" /> Sending...</>
                    ) : (
                      t.careers.submit
                    )}
                  </button>

                  <p className="text-center text-xs text-[#0d1b2a]/40 mt-2">
                    {t.careers.email_note}{' '}
                    <a href="mailto:cv@rdhotels.hu" className="text-[#c9a84c] hover:underline">cv@rdhotels.hu</a>
                  </p>
                </form>
              )}
            </div>
          </FadeIn>
        </div>
      </section>
    </WebsiteLayout>
  );
}
