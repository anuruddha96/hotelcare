import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Minus, ShoppingCart, Check, Wine, Coffee, Package, Loader2, Star, MapPin, ExternalLink, Compass, ChevronUp, ChevronDown, Globe, Info, BookOpen, Shield, Lightbulb, Map } from 'lucide-react';
import { GUEST_LANGUAGES, guestTranslations } from '@/lib/guest-minibar-translations';

interface MinibarItem {
  id: string;
  name: string;
  category: string;
  price: number;
  image_url?: string | null;
  is_promoted?: boolean;
}

interface CartItem {
  minibar_item_id: string;
  name: string;
  quantity: number;
  price: number;
}

interface HotelBranding {
  hotel_name: string;
  custom_logo_url?: string | null;
  minibar_logo_url?: string | null;
  custom_primary_color?: string | null;
}

type SubmitState = 'idle' | 'loading' | 'success' | 'error' | 'invalid';

interface GuestRecommendation {
  id: string;
  name: string;
  type: string;
  description: string | null;
  specialty: string | null;
  map_url: string | null;
  icon: string;
  sort_order: number;
}

const HOTEL_GUIDE_SECTIONS = [
  { key: 'aboutHotel', contentKey: 'aboutHotelContent', icon: Info },
  { key: 'services', contentKey: 'servicesContent', icon: BookOpen },
  { key: 'importantInfo', contentKey: 'importantInfoContent', icon: Shield },
  { key: 'thingsToKnow', contentKey: 'thingsToKnowContent', icon: Lightbulb },
  { key: 'exploreBudapest', contentKey: 'exploreBudapestContent', icon: Map },
];

export default function GuestMinibar() {
  const { roomToken, organizationSlug } = useParams<{ roomToken: string; organizationSlug: string }>();
  const [items, setItems] = useState<MinibarItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [branding, setBranding] = useState<HotelBranding | null>(null);
  const [roomNumber, setRoomNumber] = useState<string>('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<GuestRecommendation[]>([]);
  const [categoryOrder, setCategoryOrder] = useState<Record<string, number>>({});
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [openGuideSection, setOpenGuideSection] = useState<string | null>(null);
  const [guestLang, setGuestLang] = useState(() =>
    localStorage.getItem('guest_minibar_lang') || 'en'
  );

  const gt = (key: string, replacements?: Record<string, string>) => {
    let text = guestTranslations[guestLang]?.[key] || guestTranslations['en'][key] || key;
    if (replacements) {
      Object.entries(replacements).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, v);
      });
    }
    return text;
  };

  const handleLangChange = (code: string) => {
    setGuestLang(code);
    localStorage.setItem('guest_minibar_lang', code);
    setLangMenuOpen(false);
  };

  useEffect(() => {
    loadData();
  }, [roomToken]);

  const loadData = async () => {
    if (!roomToken) { setSubmitState('invalid'); setLoading(false); return; }

    try {
      const { data: room, error: roomErr } = await (supabase
        .from('rooms')
        .select('room_number, hotel') as any)
        .eq('minibar_qr_token', roomToken)
        .single();

      if (roomErr || !room) { setSubmitState('invalid'); setLoading(false); return; }

      setRoomNumber(room.room_number);

      const { data: hotelConfig } = await supabase
        .from('hotel_configurations')
        .select('hotel_name, custom_logo_url, custom_primary_color, minibar_logo_url' as any)
        .or(`hotel_id.eq.${room.hotel},hotel_name.eq.${room.hotel}`)
        .limit(1);

      if (hotelConfig && hotelConfig.length > 0) {
        const cfg = hotelConfig[0] as any;
        setBranding({
          hotel_name: cfg.hotel_name,
          custom_logo_url: cfg.custom_logo_url,
          minibar_logo_url: cfg.minibar_logo_url,
          custom_primary_color: cfg.custom_primary_color,
        });
      } else {
        setBranding({ hotel_name: room.hotel });
      }

      const { data: minibarItems } = await supabase
        .from('minibar_items')
        .select('id, name, category, price, image_url, is_promoted')
        .eq('is_active', true)
        .order('category')
        .order('name');

      setItems((minibarItems as any as MinibarItem[]) || []);

      const { data: catOrder } = await (supabase
        .from('minibar_category_order' as any)
        .select('category, sort_order')
        .order('sort_order') as any);

      if (catOrder) {
        const orderMap: Record<string, number> = {};
        (catOrder as any[]).forEach((c: any) => { orderMap[c.category] = c.sort_order; });
        setCategoryOrder(orderMap);
      }

      const { data: recs } = await (supabase
        .from('guest_recommendations' as any)
        .select('*')
        .eq('is_active', true)
        .order('sort_order') as any);

      setRecommendations((recs as any as GuestRecommendation[]) || []);
    } catch {
      setSubmitState('invalid');
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (item: MinibarItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.minibar_item_id === item.id);
      if (existing) {
        return prev.map(c => c.minibar_item_id === item.id ? { ...c, quantity: Math.min(c.quantity + 1, 20) } : c);
      }
      return [...prev, { minibar_item_id: item.id, name: item.name, quantity: 1, price: item.price }];
    });
  };

  const removeFromCart = (itemId: string) => {
    setCart(prev => {
      const existing = prev.find(c => c.minibar_item_id === itemId);
      if (existing && existing.quantity > 1) {
        return prev.map(c => c.minibar_item_id === itemId ? { ...c, quantity: c.quantity - 1 } : c);
      }
      return prev.filter(c => c.minibar_item_id !== itemId);
    });
  };

  const getCartQuantity = (itemId: string) => cart.find(c => c.minibar_item_id === itemId)?.quantity || 0;

  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);

  const handleSubmit = async () => {
    if (cart.length === 0) return;
    setSubmitState('loading');

    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/guest-minibar-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomToken,
          items: cart.map(c => ({ minibar_item_id: c.minibar_item_id, quantity: c.quantity })),
        }),
      });

      if (res.ok) {
        setSubmitState('success');
        setCart([]);
      } else {
        setSubmitState('error');
      }
    } catch {
      setSubmitState('error');
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'alcohol': return <Wine className="h-4 w-4 text-stone-400" />;
      case 'beverage': return <Coffee className="h-4 w-4 text-stone-400" />;
      default: return <Package className="h-4 w-4 text-stone-400" />;
    }
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'alcohol': return gt('alcohols');
      case 'beverage': return gt('beverages');
      case 'snack': return gt('snacks');
      default: return cat.charAt(0).toUpperCase() + cat.slice(1) + 's';
    }
  };

  const promotedItems = items.filter(i => i.is_promoted);
  const grouped = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, MinibarItem[]>);

  const logoUrl = branding?.minibar_logo_url || branding?.custom_logo_url;
  const currentLang = GUEST_LANGUAGES.find(l => l.code === guestLang) || GUEST_LANGUAGES[0];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
      </div>
    );
  }

  if (submitState === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="max-w-sm w-full text-center space-y-3">
          <h2 className="text-lg font-semibold text-stone-800">{gt('invalidQR')}</h2>
          <p className="text-sm text-stone-500">{gt('invalidDesc')}</p>
        </div>
      </div>
    );
  }

  if (submitState === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="mx-auto w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center">
            <Check className="h-7 w-7 text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold text-stone-800">{gt('thankYou')}</h2>
          <p className="text-sm text-stone-600">{gt('recorded', { room: roomNumber })}</p>
          <p className="text-xs text-stone-400">{gt('enjoyStay', { hotel: branding?.hotel_name || '' })}</p>
          <Button onClick={() => { setSubmitState('idle'); }} variant="outline" className="mt-4 rounded-full px-6">
            {gt('recordMore')}
          </Button>
        </div>
      </div>
    );
  }

  const renderWoltItem = (item: MinibarItem, featured = false) => {
    const qty = getCartQuantity(item.id);
    return (
      <div
        key={item.id}
        className={`flex items-start gap-3 py-3.5 border-b border-stone-100 last:border-b-0 ${
          qty > 0 ? 'bg-amber-50/30 -mx-4 px-4 rounded-lg' : ''
        }`}
      >
        {/* Text content */}
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-1.5">
            <p className="font-semibold text-[15px] text-stone-800 leading-snug">{item.name}</p>
          </div>
          <p className="text-sm text-amber-700 font-medium mt-0.5">
            EUR {item.price.toFixed(2)}
          </p>
          {(featured || item.is_promoted) && (
            <Badge className="bg-amber-100 text-amber-800 text-[10px] font-medium mt-1.5 border-0 px-2 py-0.5">
              ⭐ {gt('popular')}
            </Badge>
          )}
        </div>

        {/* Image */}
        {item.image_url && (
          <img
            src={item.image_url}
            alt={item.name}
            className="w-20 h-20 rounded-xl object-cover flex-shrink-0"
          />
        )}

        {/* Add/Remove controls */}
        <div className="flex flex-col items-center justify-center flex-shrink-0 pt-1">
          {qty === 0 ? (
            <button
              onClick={() => addToCart(item)}
              className="w-8 h-8 rounded-full bg-stone-800 flex items-center justify-center text-white hover:bg-stone-700 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => addToCart(item)}
                className="w-7 h-7 rounded-full bg-stone-800 flex items-center justify-center text-white hover:bg-stone-700 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <span className="text-sm font-bold text-stone-800 w-5 text-center">{qty}</span>
              <button
                onClick={() => removeFromCart(item.id)}
                className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center text-stone-500 hover:bg-stone-100 transition-colors"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const toggleGuideSection = (key: string) => {
    setOpenGuideSection(prev => prev === key ? null : key);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-stone-100">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          {logoUrl && (
            <img src={logoUrl} alt={branding?.hotel_name} className="h-9 w-auto object-contain" />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-[15px] text-stone-800 truncate">{branding?.hotel_name}</h1>
            <p className="text-xs text-stone-400">{gt('room')} {roomNumber}</p>
          </div>
          {/* Language Switcher */}
          <div className="relative">
            <button
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-stone-50 hover:bg-stone-100 transition-colors text-sm border border-stone-150"
            >
              <span className="text-base">{currentLang.flag}</span>
              <Globe className="h-3.5 w-3.5 text-stone-400" />
            </button>
            {langMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setLangMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-30 bg-white rounded-xl shadow-xl border border-stone-200 py-1 w-44 max-h-72 overflow-y-auto">
                  {GUEST_LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => handleLangChange(lang.code)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-stone-50 transition-colors ${
                        guestLang === lang.code ? 'bg-amber-50 text-amber-800 font-medium' : 'text-stone-700'
                      }`}
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {cartCount > 0 && (
            <div className="relative">
              <ShoppingCart className="h-5 w-5 text-stone-700" />
              <span className="absolute -top-1.5 -right-1.5 bg-amber-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {cartCount}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-8 pb-64">
        {/* Welcome */}
        <div className="space-y-1.5">
          <h2 className="text-2xl font-bold text-stone-800 tracking-tight">
            {gt('welcomeTo')} {branding?.hotel_name}
          </h2>
          <p className="text-sm text-stone-500 leading-relaxed">
            {gt('welcomeDesc')}
          </p>
        </div>

        {/* Featured */}
        {promotedItems.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
              <h3 className="font-bold text-stone-800 text-sm uppercase tracking-wider">{gt('featured')}</h3>
            </div>
            <div className="space-y-0">
              {promotedItems.map(item => renderWoltItem(item, true))}
            </div>
          </div>
        )}

        {/* Items by Category */}
        {Object.entries(grouped)
          .sort(([a], [b]) => (categoryOrder[a] ?? 999) - (categoryOrder[b] ?? 999))
          .map(([category, categoryItems]) => (
          <div key={category}>
            <div className="flex items-center gap-2 mb-3">
              {getCategoryIcon(category)}
              <h3 className="font-bold text-stone-800 text-sm uppercase tracking-wider">{getCategoryLabel(category)}</h3>
            </div>
            <div className="space-y-0">
              {categoryItems.map(item => renderWoltItem(item))}
            </div>
          </div>
        ))}

        {/* Hotel Guide Sections */}
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="h-4 w-4 text-stone-400" />
            <h3 className="font-bold text-stone-800 text-sm uppercase tracking-wider">{gt('hotelGuide')}</h3>
          </div>
          <div className="space-y-1">
            {HOTEL_GUIDE_SECTIONS.map(({ key, contentKey, icon: Icon }) => (
              <div key={key}>
                <button
                  onClick={() => toggleGuideSection(key)}
                  className="w-full flex items-center justify-between py-3 px-3 rounded-lg hover:bg-stone-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 text-stone-400" />
                    <span className="text-sm font-medium text-stone-700">{gt(key)}</span>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-stone-400 transition-transform ${openGuideSection === key ? 'rotate-180' : ''}`} />
                </button>
                {openGuideSection === key && (
                  <div className="px-3 pb-3 pl-9">
                    <div className="text-sm text-stone-500 leading-relaxed whitespace-pre-line">
                      {gt(contentKey)}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Discover Section */}
        {recommendations.length > 0 && (
          <div className="pt-2">
            <div className="flex items-center gap-2 mb-3">
              <Compass className="h-4 w-4 text-stone-400" />
              <h3 className="font-bold text-stone-800 text-sm uppercase tracking-wider">{gt('discover')}</h3>
            </div>
            <p className="text-sm text-stone-500 leading-relaxed mb-4">
              {gt('discoverDesc')}
            </p>
            <div className="space-y-2">
              {recommendations.map((place) => (
                <div key={place.id} className="flex items-start gap-3 py-3 border-b border-stone-100 last:border-0">
                  <span className="text-2xl mt-0.5">{place.icon}</span>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm text-stone-800">{place.name}</h4>
                    <p className="text-xs text-stone-400 mt-0.5">{place.type}</p>
                    {place.description && <p className="text-xs text-stone-500 mt-1 leading-relaxed">{place.description}</p>}
                    {place.specialty && <p className="text-xs font-medium text-amber-700 mt-1">{place.specialty}</p>}
                  </div>
                  {place.map_url && (
                    <a
                      href={place.map_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 px-2 py-1 rounded-full border border-stone-200 hover:border-stone-300 transition-colors flex-shrink-0 mt-1"
                    >
                      <MapPin className="h-3 w-3" />
                      {gt('map')}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-stone-100 pt-6 pb-4 mt-8">
          <div className="flex flex-col items-center gap-2 text-center">
            {logoUrl && (
              <img src={logoUrl} alt={branding?.hotel_name} className="h-7 w-auto object-contain opacity-40" />
            )}
            <p className="text-xs text-stone-300">{branding?.hotel_name}</p>
            <p className="text-[10px] text-stone-300">{gt('poweredBy')}</p>
          </div>
        </div>
      </div>

      {/* Sticky Cart Footer */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 shadow-[0_-2px_16px_rgba(0,0,0,0.06)] z-20">
          <div className="max-w-lg mx-auto px-4 py-3 space-y-2">
            {/* Cart item breakdown - always visible */}
            <div className="max-h-36 overflow-y-auto space-y-1.5">
              {cart.map(item => (
                <div key={item.minibar_item_id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => removeFromCart(item.minibar_item_id)}
                        className="h-5 w-5 rounded-full border border-stone-300 flex items-center justify-center text-stone-400 hover:bg-stone-100"
                      >
                        <Minus className="h-2.5 w-2.5" />
                      </button>
                      <span className="w-4 text-center text-xs font-semibold text-stone-700">{item.quantity}</span>
                      <button
                        onClick={() => addToCart({ id: item.minibar_item_id, name: item.name, category: '', price: item.price } as MinibarItem)}
                        className="h-5 w-5 rounded-full bg-stone-800 flex items-center justify-center text-white hover:bg-stone-700"
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                    </div>
                    <span className="text-stone-600 truncate text-xs">{item.name}</span>
                  </div>
                  <span className="text-xs font-medium text-stone-700 flex-shrink-0 ml-2">€{(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="flex items-center justify-between pt-1.5 border-t border-stone-100">
              <span className="text-sm font-semibold text-stone-800">{gt('total')}</span>
              <span className="text-sm font-bold text-stone-800">€{cartTotal.toFixed(2)}</span>
            </div>

            {/* VAT & Payment info */}
            <p className="text-[10px] text-stone-400 leading-snug">
              {gt('vatIncluded')} {gt('paymentInfo')}
            </p>

            <Button
              onClick={handleSubmit}
              disabled={submitState === 'loading'}
              className="w-full bg-stone-800 hover:bg-stone-900 text-white rounded-xl h-11 text-sm font-semibold"
            >
              {submitState === 'loading' ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{gt('recording')}</>
              ) : (
                <><ShoppingCart className="h-4 w-4 mr-2" />{gt('confirmUsage')} • €{cartTotal.toFixed(2)}</>
              )}
            </Button>
            <p className="text-[10px] text-center text-stone-400">
              {gt('noPayment')}
            </p>
          </div>
        </div>
      )}

      {submitState === 'error' && (
        <div className="fixed bottom-20 left-4 right-4 max-w-lg mx-auto bg-red-50 border border-red-200 rounded-lg p-3 text-center text-sm text-red-700 z-30">
          {gt('error')}
          <Button size="sm" variant="ghost" onClick={() => setSubmitState('idle')} className="ml-2">{gt('dismiss')}</Button>
        </div>
      )}
    </div>
  );
}
