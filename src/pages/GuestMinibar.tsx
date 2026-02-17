import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Minus, ShoppingCart, Check, Wine, Coffee, Package, Loader2, Star, MapPin, ExternalLink, Compass, ChevronUp, ChevronDown, Globe } from 'lucide-react';
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
  const [cartExpanded, setCartExpanded] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
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
      case 'alcohol': return <Wine className="h-5 w-5" />;
      case 'beverage': return <Coffee className="h-5 w-5" />;
      default: return <Package className="h-5 w-5" />;
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-stone-50 to-amber-50/30">
        <Loader2 className="h-8 w-8 animate-spin text-amber-700" />
      </div>
    );
  }

  if (submitState === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-stone-50 to-amber-50/30 p-4">
        <Card className="max-w-md w-full text-center p-8 shadow-xl border-0">
          <h2 className="text-xl font-semibold mb-2">{gt('invalidQR')}</h2>
          <p className="text-muted-foreground">{gt('invalidDesc')}</p>
        </Card>
      </div>
    );
  }

  if (submitState === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-50 p-4">
        <Card className="max-w-md w-full text-center p-8 space-y-4 shadow-xl border-0">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-semibold text-green-800">{gt('thankYou')}</h2>
          <p className="text-green-700">{gt('recorded', { room: roomNumber })}</p>
          <p className="text-sm text-muted-foreground">{gt('enjoyStay', { hotel: branding?.hotel_name || '' })}</p>
          <Button onClick={() => { setSubmitState('idle'); }} variant="outline" className="mt-4">
            {gt('recordMore')}
          </Button>
        </Card>
      </div>
    );
  }

  const renderItemCard = (item: MinibarItem, featured = false) => {
    const qty = getCartQuantity(item.id);
    return (
      <Card
        key={item.id}
        className={`transition-all duration-200 border-0 shadow-sm hover:shadow-md ${
          featured
            ? 'ring-1 ring-amber-300 bg-gradient-to-r from-amber-50/80 to-yellow-50/80'
            : qty > 0
            ? 'ring-1 ring-amber-400 bg-amber-50/40'
            : 'bg-white'
        }`}
      >
        <CardContent className="p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {item.image_url && (
              <img
                src={item.image_url}
                alt={item.name}
                className="w-12 h-12 rounded-xl object-cover border border-stone-200 flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {featured && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 flex-shrink-0" />}
                <p className="font-medium text-sm truncate text-stone-800">{item.name}</p>
              </div>
              <p className="text-xs text-stone-500 font-medium">€{item.price.toFixed(2)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {qty > 0 && (
              <Button size="icon" variant="outline" className="h-7 w-7 rounded-full border-stone-300" onClick={() => removeFromCart(item.id)}>
                <Minus className="h-3 w-3" />
              </Button>
            )}
            {qty > 0 && <span className="w-5 text-center font-semibold text-sm text-stone-800">{qty}</span>}
            <Button size="icon" className="h-7 w-7 rounded-full bg-amber-600 hover:bg-amber-700 shadow-sm" onClick={() => addToCart(item)}>
              <Plus className="h-3 w-3 text-white" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 via-amber-50/20 to-stone-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-stone-200 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          {logoUrl && (
            <img src={logoUrl} alt={branding?.hotel_name} className="h-10 w-auto object-contain" />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-base text-stone-800 truncate">{branding?.hotel_name}</h1>
            <p className="text-xs text-stone-500">{gt('room')} {roomNumber} • {gt('minibar')}</p>
          </div>
          {/* Language Switcher */}
          <div className="relative">
            <button
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-stone-100 hover:bg-stone-200 transition-colors text-sm"
            >
              <span>{currentLang.flag}</span>
              <Globe className="h-3.5 w-3.5 text-stone-500" />
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
            <Badge className="bg-amber-600 text-white shadow-sm">{cartCount}</Badge>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-8 pb-36">
        {/* Welcome Message */}
        <div className="text-center space-y-2 pt-2">
          <h2 className="text-2xl font-serif font-medium text-stone-800">
            {gt('welcomeTo')} {branding?.hotel_name}
          </h2>
          <p className="text-sm text-stone-500 leading-relaxed max-w-sm mx-auto">
            {gt('welcomeDesc')}
          </p>
        </div>

        {/* Featured / Promoted Items */}
        {promotedItems.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
              <h3 className="font-semibold text-stone-800 text-sm uppercase tracking-wide">{gt('featured')}</h3>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {promotedItems.map(item => renderItemCard(item, true))}
            </div>
          </div>
        )}

        {/* Items by Category */}
        {Object.entries(grouped)
          .sort(([a], [b]) => (categoryOrder[a] ?? 999) - (categoryOrder[b] ?? 999))
          .map(([category, categoryItems]) => (
          <div key={category} className="space-y-3">
            <div className="flex items-center gap-2">
              {getCategoryIcon(category)}
              <h3 className="font-semibold text-stone-800 text-sm uppercase tracking-wide">{getCategoryLabel(category)}</h3>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {categoryItems.map(item => renderItemCard(item))}
            </div>
          </div>
        ))}

        {/* Discover Section */}
        {recommendations.length > 0 && (
          <div className="space-y-4 pt-4">
            <div className="flex items-center gap-2">
              <Compass className="h-5 w-5 text-amber-700" />
              <h3 className="font-semibold text-stone-800 text-lg">{gt('discover')}</h3>
            </div>
            <p className="text-sm text-stone-500 leading-relaxed">
              {gt('discoverDesc')}
            </p>
            <div className="grid grid-cols-1 gap-3">
              {recommendations.map((place) => (
                <Card key={place.id} className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{place.icon}</span>
                        <div>
                          <h4 className="font-semibold text-sm text-stone-800">{place.name}</h4>
                          <p className="text-xs text-stone-500">{place.type}</p>
                        </div>
                      </div>
                      {place.map_url && (
                        <a
                          href={place.map_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-full transition-colors flex-shrink-0"
                        >
                          <MapPin className="h-3 w-3" />
                          {gt('map')}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-stone-500 leading-relaxed">{place.description}</p>
                    {place.specialty && <p className="text-xs font-medium text-amber-800">{place.specialty}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-stone-200 pt-6 pb-4 mt-8">
          <div className="flex flex-col items-center gap-3 text-center">
            {logoUrl && (
              <img src={logoUrl} alt={branding?.hotel_name} className="h-8 w-auto object-contain opacity-60" />
            )}
            <p className="text-xs text-stone-400 font-medium">{branding?.hotel_name}</p>
            <p className="text-[10px] text-stone-300">{gt('poweredBy')}</p>
          </div>
        </div>
      </div>

      {/* Sticky Cart Footer */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] z-20">
          <div className="max-w-lg mx-auto px-4 py-3 space-y-2">
            {/* Cart summary toggle */}
            <button
              onClick={() => setCartExpanded(!cartExpanded)}
              className="w-full flex items-center justify-between text-sm py-1"
            >
              <span className="text-stone-600 flex items-center gap-1.5">
                <ShoppingCart className="h-3.5 w-3.5" />
                {cartCount} {gt('items')}
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-stone-800">
                €{cartTotal.toFixed(2)}
                {cartExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </span>
            </button>

            {/* Expandable cart details */}
            {cartExpanded && (
              <div className="max-h-44 overflow-y-auto space-y-1.5 border-t border-stone-100 pt-2 pb-1">
                {cart.map(item => (
                  <div key={item.minibar_item_id} className="flex items-center justify-between text-sm">
                    <span className="text-stone-700 truncate flex-1 mr-2">{item.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => removeFromCart(item.minibar_item_id)}
                        className="h-5 w-5 rounded-full border border-stone-300 flex items-center justify-center text-stone-500 hover:bg-stone-100"
                      >
                        <Minus className="h-2.5 w-2.5" />
                      </button>
                      <span className="w-4 text-center text-xs font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => addToCart({ id: item.minibar_item_id, name: item.name, category: '', price: item.price } as MinibarItem)}
                        className="h-5 w-5 rounded-full bg-amber-600 flex items-center justify-center text-white hover:bg-amber-700"
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                      <span className="text-xs text-stone-500 w-14 text-right">€{(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={submitState === 'loading'}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white shadow-sm h-11"
            >
              {submitState === 'loading' ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{gt('recording')}</>
              ) : (
                <><ShoppingCart className="h-4 w-4 mr-2" />{gt('confirmUsage')}</>
              )}
            </Button>
            <p className="text-[11px] text-center text-stone-400">
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
