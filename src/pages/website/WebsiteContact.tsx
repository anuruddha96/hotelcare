import React, { useRef, useEffect } from 'react';
import { motion, useInView } from 'framer-motion';
import { MapPin, Clock, Mail, Linkedin, Facebook, CheckCircle2, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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

const contactSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().optional(),
  company: z.string().optional(),
  interest: z.string().optional(),
  message: z.string().optional(),
});

type ContactFormData = z.infer<typeof contactSchema>;

export default function WebsiteContact() {
  const { t, language } = useWebsiteLang();
  const [serverError, setServerError] = React.useState('');
  const [success, setSuccess] = React.useState(false);

  useEffect(() => {
    document.title = `RD Hotels | ${t.nav.contact}`;
  }, [t]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({ resolver: zodResolver(contactSchema) });

  const onSubmit = async (data: ContactFormData) => {
    setServerError('');
    const { error: dbError } = await supabase.from('website_leads').insert({
      lead_type: 'contact',
      full_name: data.full_name,
      email: data.email,
      phone: data.phone || null,
      company: data.company || null,
      message: data.message || null,
      interest: data.interest || null,
      language,
    });

    if (dbError) {
      setServerError('Something went wrong. Please try again or email us directly.');
    } else {
      setSuccess(true);
      reset();
    }
  };

  const inputBase = 'w-full bg-white border rounded-xl px-4 py-3.5 text-[#0d1b2a] placeholder-[#0d1b2a]/30 text-sm focus:outline-none focus:ring-2 transition-all';
  const inputNormal = `${inputBase} border-[#e5e0d8] focus:border-[#c9a84c] focus:ring-[#c9a84c]/20`;
  const inputError = `${inputBase} border-red-400 focus:border-red-400 focus:ring-red-200`;

  const fieldClass = (hasError: boolean) => hasError ? inputError : inputNormal;

  return (
    <WebsiteLayout>
      {/* Hero */}
      <section className="relative bg-[#0d1b2a] pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-[#c9a84c]/8 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-block text-[#c9a84c] text-xs tracking-[0.4em] uppercase font-medium mb-6 border border-[#c9a84c]/30 px-4 py-1.5 rounded-full"
          >
            {t.nav.contact}
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-5"
          >
            {t.contact.title}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-xl text-white/50 max-w-xl mx-auto"
          >
            {t.contact.subtitle}
          </motion.p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-20 bg-[#f8f6f2]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">

            {/* Form */}
            <FadeIn className="lg:col-span-3">
              <div className="bg-white rounded-3xl p-8 sm:p-10 shadow-sm">
                <h2 className="text-2xl font-bold text-[#0d1b2a] mb-1">{t.contact.form_title}</h2>
                <p className="text-[#0d1b2a]/50 mb-8">{t.contact.form_subtitle}</p>

                {success ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center gap-4 py-12 text-center"
                  >
                    <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center">
                      <CheckCircle2 size={32} className="text-green-500" />
                    </div>
                    <p className="text-lg font-semibold text-[#0d1b2a]">{t.contact.success}</p>
                    <button
                      onClick={() => setSuccess(false)}
                      className="text-sm text-[#c9a84c] hover:underline mt-2"
                    >
                      Send another message
                    </button>
                  </motion.div>
                ) : (
                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-xs font-semibold text-[#0d1b2a]/60 uppercase tracking-widest mb-2">
                          {t.contact.field_name} *
                        </label>
                        <input
                          {...register('full_name')}
                          className={fieldClass(!!errors.full_name)}
                          placeholder="John Doe"
                        />
                        {errors.full_name && (
                          <p className="mt-1.5 text-xs text-red-500">{errors.full_name.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#0d1b2a]/60 uppercase tracking-widest mb-2">
                          {t.contact.field_email} *
                        </label>
                        <input
                          {...register('email')}
                          type="email"
                          className={fieldClass(!!errors.email)}
                          placeholder="john@example.com"
                        />
                        {errors.email && (
                          <p className="mt-1.5 text-xs text-red-500">{errors.email.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-xs font-semibold text-[#0d1b2a]/60 uppercase tracking-widest mb-2">
                          {t.contact.field_phone}
                        </label>
                        <input
                          {...register('phone')}
                          type="tel"
                          className={fieldClass(!!errors.phone)}
                          placeholder="+36 ..."
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#0d1b2a]/60 uppercase tracking-widest mb-2">
                          {t.contact.field_company}
                        </label>
                        <input
                          {...register('company')}
                          className={fieldClass(!!errors.company)}
                          placeholder="Hotel / Company name"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#0d1b2a]/60 uppercase tracking-widest mb-2">
                        {t.contact.field_interest}
                      </label>
                      <select
                        {...register('interest')}
                        className={fieldClass(false) + ' cursor-pointer'}
                      >
                        <option value="">— Select —</option>
                        <option value="management">{t.contact.interest_management}</option>
                        <option value="revenue">{t.contact.interest_revenue}</option>
                        <option value="hr">{t.contact.interest_hr}</option>
                        <option value="other">{t.contact.interest_other}</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#0d1b2a]/60 uppercase tracking-widest mb-2">
                        {t.contact.field_message}
                      </label>
                      <textarea
                        {...register('message')}
                        rows={5}
                        className={fieldClass(false) + ' resize-none'}
                        placeholder="Tell us about your property and how we can help..."
                      />
                    </div>

                    {serverError && (
                      <p className="text-red-500 text-sm">{serverError}</p>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full flex items-center justify-center gap-2 bg-[#0d1b2a] hover:bg-[#1a2f45] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99]"
                    >
                      {isSubmitting ? (
                        <><Loader2 size={18} className="animate-spin" /> Sending...</>
                      ) : (
                        t.contact.submit
                      )}
                    </button>
                  </form>
                )}
              </div>
            </FadeIn>

            {/* Info Panel */}
            <FadeIn delay={0.15} className="lg:col-span-2 space-y-5">
              <div className="bg-[#0d1b2a] rounded-2xl p-7">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 bg-[#c9a84c]/15 rounded-lg flex items-center justify-center">
                    <MapPin size={16} className="text-[#c9a84c]" />
                  </div>
                  <h3 className="text-white font-semibold">{t.contact.addr_title}</h3>
                </div>
                <p className="text-white/50 text-sm leading-relaxed">{t.contact.addr}</p>
              </div>

              <div className="bg-white rounded-2xl p-7 border border-[#e8e0d0]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 bg-[#0d1b2a] rounded-lg flex items-center justify-center">
                    <Clock size={16} className="text-[#c9a84c]" />
                  </div>
                  <h3 className="text-[#0d1b2a] font-semibold">{t.contact.hours_title}</h3>
                </div>
                <p className="text-[#0d1b2a]/55 text-sm">{t.contact.hours}</p>
              </div>

              <div className="bg-white rounded-2xl p-7 border border-[#e8e0d0]">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 bg-[#0d1b2a] rounded-lg flex items-center justify-center">
                    <Mail size={16} className="text-[#c9a84c]" />
                  </div>
                  <h3 className="text-[#0d1b2a] font-semibold">{t.contact.email_title}</h3>
                </div>
                <a href="mailto:info@rdhotels.hu" className="text-[#c9a84c] hover:underline text-sm font-medium">
                  info@rdhotels.hu
                </a>
              </div>

              <div className="bg-[#f8f6f2] rounded-2xl p-7 border border-[#e8e0d0]">
                <h3 className="text-[#0d1b2a] font-semibold mb-4">{t.footer.follow}</h3>
                <div className="flex gap-4">
                  <a
                    href="https://www.linkedin.com/company/rdhotels"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-[#0d1b2a]/70 hover:text-[#c9a84c] transition-colors font-medium"
                  >
                    <Linkedin size={16} /> LinkedIn
                  </a>
                  <a
                    href="https://www.facebook.com/rdhotels"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-[#0d1b2a]/70 hover:text-[#c9a84c] transition-colors font-medium"
                  >
                    <Facebook size={16} /> Facebook
                  </a>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>
    </WebsiteLayout>
  );
}
