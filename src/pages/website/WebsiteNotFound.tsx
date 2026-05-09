import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Home } from 'lucide-react';
import { useWebsiteLang } from '@/contexts/WebsiteLanguageContext';
import WebsiteLayout from './WebsiteLayout';

export default function WebsiteNotFound() {
  const { language } = useWebsiteLang();

  useEffect(() => {
    document.title = 'RD Hotels | 404 — Page Not Found';
  }, []);

  const messages: Record<string, { heading: string; body: string; back: string; home: string }> = {
    en: { heading: 'Page Not Found', body: "The page you're looking for doesn't exist or has been moved.", back: 'Go Back', home: 'Back to Home' },
    hu: { heading: 'Az oldal nem található', body: 'A keresett oldal nem létezik vagy áthelyezték.', back: 'Vissza', home: 'Főoldalra' },
    de: { heading: 'Seite nicht gefunden', body: 'Die gesuchte Seite existiert nicht oder wurde verschoben.', back: 'Zurück', home: 'Zur Startseite' },
    cs: { heading: 'Stránka nenalezena', body: 'Stránka, kterou hledáte, neexistuje nebo byla přesunuta.', back: 'Zpět', home: 'Na hlavní stránku' },
    sk: { heading: 'Stránka sa nenašla', body: 'Stránka, ktorú hľadáte, neexistuje alebo bola presunutá.', back: 'Späť', home: 'Na hlavnú stránku' },
    pl: { heading: 'Strona nie znaleziona', body: 'Strona, której szukasz, nie istnieje lub została przeniesiona.', back: 'Wróć', home: 'Na stronę główną' },
    ro: { heading: 'Pagină negăsită', body: 'Pagina căutată nu există sau a fost mutată.', back: 'Înapoi', home: 'Acasă' },
    hr: { heading: 'Stranica nije pronađena', body: 'Stranica koju tražite ne postoji ili je premještena.', back: 'Natrag', home: 'Na početnu' },
    sl: { heading: 'Stran ni najdena', body: 'Stran, ki jo iščete, ne obstaja ali je bila premaknjena.', back: 'Nazaj', home: 'Na domačo stran' },
    sr: { heading: 'Stranica nije pronađena', body: 'Stranica koju tražite ne postoji ili je premještena.', back: 'Nazad', home: 'Na početnu' },
    bg: { heading: 'Страницата не е намерена', body: 'Страницата, която търсите, не съществува или е преместена.', back: 'Назад', home: 'Начало' },
  };

  const msg = messages[language] ?? messages.en;

  return (
    <WebsiteLayout>
      <section className="min-h-screen bg-[#0d1b2a] flex items-center justify-center px-4 pt-20">
        {/* Decorative background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#c9a84c]/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-[#c9a84c]/4 rounded-full blur-3xl" />
        </div>

        <div className="relative text-center max-w-lg mx-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            {/* 404 number */}
            <div className="text-[10rem] sm:text-[14rem] font-bold leading-none text-[#c9a84c]/15 select-none mb-0">
              404
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="-mt-8 relative z-10"
          >
            {/* Logo mark */}
            <div className="flex flex-col items-center mb-8">
              <div className="w-px h-10 bg-gradient-to-b from-[#c9a84c]/60 to-transparent mb-6" />
              <span className="text-4xl font-bold tracking-widest text-white">RD</span>
              <span className="text-[10px] tracking-[0.4em] text-[#c9a84c] uppercase font-medium mt-1">Hotels</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              {msg.heading}
            </h1>
            <p className="text-white/50 mb-10 text-lg leading-relaxed">
              {msg.body}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => window.history.back()}
                className="inline-flex items-center justify-center gap-2 border border-white/20 hover:border-white/40 text-white font-medium px-6 py-3.5 rounded-xl transition-all hover:bg-white/5"
              >
                <ArrowLeft size={16} /> {msg.back}
              </button>
              <Link
                to="/"
                className="inline-flex items-center justify-center gap-2 bg-[#c9a84c] hover:bg-[#b8973b] text-[#0d1b2a] font-semibold px-6 py-3.5 rounded-xl transition-all hover:scale-105"
              >
                <Home size={16} /> {msg.home}
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </WebsiteLayout>
  );
}
