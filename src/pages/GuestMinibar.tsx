import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Minus, ShoppingCart, Check, Wine, Coffee, Package, Loader2, Star, MapPin, ExternalLink, Compass } from 'lucide-react';

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
        .select('hotel_name, custom_logo_url, custom_primary_color')
        .or(`hotel_id.eq.${room.hotel},hotel_name.eq.${room.hotel}`)
        .limit(1);

      if (hotelConfig && hotelConfig.length > 0) {
        setBranding(hotelConfig[0]);
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

      // Fetch category order
      const { data: catOrder } = await (supabase
        .from('minibar_category_order' as any)
        .select('category, sort_order')
        .order('sort_order') as any);

      if (catOrder) {
        const orderMap: Record<string, number> = {};
        (catOrder as any[]).forEach((c: any) => { orderMap[c.category] = c.sort_order; });
        setCategoryOrder(orderMap);
      }

      // Fetch recommendations
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

  const promotedItems = items.filter(i => i.is_promoted);
  const grouped = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, MinibarItem[]>);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50">
        <Loader2 className="h-8 w-8 animate-spin text-amber-700" />
      </div>
    );
  }

  if (submitState === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 p-4">
        <Card className="max-w-md w-full text-center p-8">
          <h2 className="text-xl font-semibold mb-2">Invalid QR Code</h2>
          <p className="text-muted-foreground">This minibar QR code is not valid. Please contact the front desk.</p>
        </Card>
      </div>
    );
  }

  if (submitState === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-50 p-4">
        <Card className="max-w-md w-full text-center p-8 space-y-4">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-semibold text-green-800">Thank You!</h2>
          <p className="text-green-700">Your minibar usage for Room {roomNumber} has been recorded.</p>
          <p className="text-sm text-muted-foreground">Enjoy your stay at {branding?.hotel_name}!</p>
          <Button onClick={() => { setSubmitState('idle'); }} variant="outline" className="mt-4">
            Record More Items
          </Button>
        </Card>
      </div>
    );
  }

  const primaryColor = branding?.custom_primary_color || 'hsl(30, 60%, 40%)';

  const renderItemCard = (item: MinibarItem, featured = false) => {
    const qty = getCartQuantity(item.id);
    return (
      <Card key={item.id} className={`transition-all ${featured ? 'ring-2 ring-amber-400 bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200' : ''} ${qty > 0 && !featured ? 'ring-2 ring-amber-400 bg-amber-50/50' : !featured ? 'bg-white' : ''}`}>
        <CardContent className="p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {item.image_url && (
              <img 
                src={item.image_url} 
                alt={item.name} 
                className="w-12 h-12 rounded-lg object-cover border border-amber-200 flex-shrink-0" 
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {featured && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 flex-shrink-0" />}
                <p className="font-medium text-sm truncate">{item.name}</p>
              </div>
              <p className="text-xs text-muted-foreground">€{item.price.toFixed(2)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {qty > 0 && (
              <Button size="icon" variant="outline" className="h-8 w-8 rounded-full" onClick={() => removeFromCart(item.id)}>
                <Minus className="h-3 w-3" />
              </Button>
            )}
            {qty > 0 && <span className="w-6 text-center font-semibold text-sm">{qty}</span>}
            <Button size="icon" className="h-8 w-8 rounded-full bg-amber-600 hover:bg-amber-700" onClick={() => addToCart(item)}>
              <Plus className="h-3 w-3 text-white" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm border-b shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          {branding?.custom_logo_url && (
            <img src={branding.custom_logo_url} alt={branding.hotel_name} className="h-10 w-auto object-contain" />
          )}
          <div className="flex-1">
            <h1 className="font-semibold text-lg" style={{ color: primaryColor }}>{branding?.hotel_name}</h1>
            <p className="text-xs text-muted-foreground">Room {roomNumber} • Minibar</p>
          </div>
          {cart.length > 0 && (
            <Badge className="bg-amber-600 text-white">{cart.reduce((s, c) => s + c.quantity, 0)}</Badge>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6 pb-32">
        {/* Welcome message */}
        <div className="text-center space-y-1">
          <h2 className="text-xl font-medium text-amber-900">Welcome to your Minibar</h2>
          <p className="text-sm text-amber-700/80">
            Enjoyed something from the minibar? Simply tap to record your selection below.
          </p>
        </div>

        {/* Featured / Promoted Items */}
        {promotedItems.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
              <h3 className="font-semibold text-amber-900">Featured</h3>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {promotedItems.map(item => renderItemCard(item, true))}
            </div>
          </div>
        )}

        {/* Items by category */}
        {Object.entries(grouped)
          .sort(([a], [b]) => (categoryOrder[a] ?? 999) - (categoryOrder[b] ?? 999))
          .map(([category, categoryItems]) => (
          <div key={category} className="space-y-3">
            <div className="flex items-center gap-2">
              {getCategoryIcon(category)}
              <h3 className="font-semibold text-amber-900 capitalize">{category}s</h3>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {categoryItems.map(item => renderItemCard(item))}
            </div>
          </div>
        ))}

        {/* Discover Section */}
        <div className="space-y-4 pt-4">
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-amber-700" />
            <h3 className="font-semibold text-amber-900 text-lg">Discover Budapest</h3>
          </div>
          <p className="text-sm text-amber-700/80">
            Explore the best of Budapest — handpicked by our team for an unforgettable stay.
          </p>
          <div className="grid grid-cols-1 gap-3">
            {recommendations.map((place) => (
              <Card key={place.name} className="bg-white/80 border-amber-100 hover:shadow-md transition-shadow">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{place.icon}</span>
                      <div>
                        <h4 className="font-semibold text-sm text-amber-900">{place.name}</h4>
                        <p className="text-xs text-amber-600">{place.type}</p>
                      </div>
                    </div>
                    <a
                      href={place.map_url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 bg-amber-100 hover:bg-amber-200 px-2 py-1 rounded-full transition-colors flex-shrink-0"
                    >
                      <MapPin className="h-3 w-3" />
                      Map
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{place.description}</p>
                  <p className="text-xs font-medium text-amber-800">{place.specialty}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Sticky Cart Footer */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-20">
          <div className="max-w-lg mx-auto px-4 py-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{cart.reduce((s, c) => s + c.quantity, 0)} items</span>
              <span className="font-semibold">€{cartTotal.toFixed(2)}</span>
            </div>
            <Button
              onClick={handleSubmit}
              disabled={submitState === 'loading'}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white"
            >
              {submitState === 'loading' ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Recording...</>
              ) : (
                <><ShoppingCart className="h-4 w-4 mr-2" />Confirm Usage</>
              )}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              This simply records what you've enjoyed — no payment needed here.
            </p>
          </div>
        </div>
      )}

      {submitState === 'error' && (
        <div className="fixed bottom-20 left-4 right-4 max-w-lg mx-auto bg-red-50 border border-red-200 rounded-lg p-3 text-center text-sm text-red-700">
          Something went wrong. Please try again or contact the front desk.
          <Button size="sm" variant="ghost" onClick={() => setSubmitState('idle')} className="ml-2">Dismiss</Button>
        </div>
      )}
    </div>
  );
}
