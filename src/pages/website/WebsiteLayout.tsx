import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ChevronDown, Globe, Linkedin, Facebook } from 'lucide-react';
import { useWebsiteLang } from '@/contexts/WebsiteLanguageContext';

const navLinks = [
  { key: 'home' as const, href: '/' },
  { key: 'about' as const, href: '/about-us' },
  { key: 'contact' as const, href: '/contact' },
  { key: 'team' as const, href: '/team' },
  { key: 'careers' as const, href: '/join-our-team' },
];

export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  const { t, language, setLanguage, languages } = useWebsiteLang();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const currentLang = languages.find(l => l.code === language);

  return (
    <div className="min-h-screen bg-white font-sans">
      {/* Navbar */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'bg-[#0d1b2a]/95 backdrop-blur-md shadow-lg' : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3 group">
              <div className="flex flex-col leading-tight">
                <span className="text-2xl font-bold tracking-widest text-white">RD</span>
                <span className="text-[10px] tracking-[0.3em] text-[#c9a84c] uppercase font-medium">Hotels</span>
              </div>
            </Link>

            {/* Desktop Nav */}
            <nav className="hidden lg:flex items-center gap-1">
              {navLinks.map(link => (
                <Link
                  key={link.key}
                  to={link.href}
                  className={`px-4 py-2 text-sm font-medium tracking-wide rounded transition-all duration-200 ${
                    location.pathname === link.href
                      ? 'text-[#c9a84c]'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {t.nav[link.key]}
                </Link>
              ))}
            </nav>

            {/* Language Switcher + Mobile Menu */}
            <div className="flex items-center gap-3">
              {/* Language Switcher */}
              <div className="relative">
                <button
                  onClick={() => setLangOpen(!langOpen)}
                  className="flex items-center gap-2 px-3 py-2 rounded text-white/80 hover:text-white hover:bg-white/10 transition-all text-sm font-medium"
                >
                  <Globe size={15} />
                  <span className="hidden sm:block">{currentLang?.flag} {currentLang?.label}</span>
                  <span className="sm:hidden">{currentLang?.flag}</span>
                  <ChevronDown size={13} className={`transition-transform ${langOpen ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {langOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-48 bg-[#0d1b2a] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
                    >
                      {languages.map(lang => (
                        <button
                          key={lang.code}
                          onClick={() => { setLanguage(lang.code); setLangOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                            language === lang.code
                              ? 'bg-[#c9a84c]/20 text-[#c9a84c]'
                              : 'text-white/80 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <span>{lang.flag}</span>
                          <span>{lang.label}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Mobile Menu Toggle */}
              <button
                onClick={() => setMobileOpen(!mobileOpen)}
                className="lg:hidden p-2 text-white/80 hover:text-white transition-colors"
                aria-label="Toggle menu"
              >
                {mobileOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="lg:hidden bg-[#0d1b2a]/98 backdrop-blur-lg border-t border-white/10"
            >
              <nav className="flex flex-col px-4 py-4 gap-1">
                {navLinks.map(link => (
                  <Link
                    key={link.key}
                    to={link.href}
                    className={`px-4 py-3 text-sm font-medium rounded-lg transition-all ${
                      location.pathname === link.href
                        ? 'text-[#c9a84c] bg-[#c9a84c]/10'
                        : 'text-white/80 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {t.nav[link.key]}
                  </Link>
                ))}
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Click outside to close dropdowns */}
      {(langOpen) && (
        <div className="fixed inset-0 z-40" onClick={() => setLangOpen(false)} />
      )}

      {/* Page Content */}
      <main>{children}</main>

      {/* Footer */}
      <footer className="bg-[#0d1b2a] text-white/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {/* Brand */}
            <div className="col-span-1">
              <div className="flex flex-col mb-6">
                <span className="text-3xl font-bold tracking-widest text-white">RD</span>
                <span className="text-xs tracking-[0.3em] text-[#c9a84c] uppercase font-medium">Hotels</span>
              </div>
              <p className="text-sm leading-relaxed text-white/50 max-w-xs">
                {t.footer.legal}
              </p>
            </div>

            {/* Navigation */}
            <div>
              <h4 className="text-white font-semibold mb-4 tracking-wide uppercase text-xs">Navigation</h4>
              <ul className="space-y-3">
                {navLinks.map(link => (
                  <li key={link.key}>
                    <Link
                      to={link.href}
                      className="text-sm text-white/50 hover:text-[#c9a84c] transition-colors"
                    >
                      {t.nav[link.key]}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h4 className="text-white font-semibold mb-4 tracking-wide uppercase text-xs">Contact</h4>
              <ul className="space-y-3 text-sm text-white/50">
                <li>
                  <a href="mailto:info@rdhotels.hu" className="hover:text-[#c9a84c] transition-colors">
                    info@rdhotels.hu
                  </a>
                </li>
                <li className="leading-relaxed">
                  1075 Budapest, Király street 13<br />III building, 1st floor, Unit 2
                </li>
              </ul>
              <div className="flex gap-4 mt-6">
                <a
                  href="https://www.linkedin.com/company/rdhotels"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/40 hover:text-[#c9a84c] transition-colors"
                  aria-label="LinkedIn"
                >
                  <Linkedin size={18} />
                </a>
                <a
                  href="https://www.facebook.com/rdhotels"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/40 hover:text-[#c9a84c] transition-colors"
                  aria-label="Facebook"
                >
                  <Facebook size={18} />
                </a>
              </div>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-white/10 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-xs text-white/30">{t.footer.copyright}</p>
            <p className="text-xs text-white/20">Designed & Created with passion by Anu</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
