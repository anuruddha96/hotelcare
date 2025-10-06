import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Calendar as CalendarIcon, Package, Search, Eye, CheckCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface LostAndFoundItem {
  id: string;
  room_id: string;
  item_description: string;
  photo_urls: string[];
  found_date: string;
  reported_by: string;
  status: string;
  claimed_at: string | null;
  claimed_by: string | null;
  notes: string | null;
  rooms: {
    room_number: string;
    hotel: string;
  };
  profiles: {
    full_name: string;
  };
}

export function LostAndFoundManagement() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [items, setItems] = useState<LostAndFoundItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchRoom, setSearchRoom] = useState('');
  const [selectedItem, setSelectedItem] = useState<LostAndFoundItem | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [claimedBy, setClaimedBy] = useState('');

  useEffect(() => {
    fetchLostAndFound();
  }, [selectedDate]);

  const fetchLostAndFound = async () => {
    setLoading(true);
    try {
      const startDate = startOfDay(selectedDate);
      const endDate = endOfDay(selectedDate);

      const { data, error } = await supabase
        .from('lost_and_found')
        .select(`
          *,
          rooms (
            room_number,
            hotel
          ),
          profiles!lost_and_found_reported_by_fkey (
            full_name
          )
        `)
        .gte('found_date', format(startDate, 'yyyy-MM-dd'))
        .lte('found_date', format(endDate, 'yyyy-MM-dd'))
        .order('found_date', { ascending: false });

      if (error) throw error;
      setItems(data as any || []);
    } catch (error: any) {
      console.error('Error fetching lost and found:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch lost and found items',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClaimItem = async () => {
    if (!selectedItem || !claimedBy.trim()) return;
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('lost_and_found')
        .update({
          status: 'claimed',
          claimed_at: new Date().toISOString(),
          claimed_by: claimedBy,
        })
        .eq('id', selectedItem.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Item marked as claimed successfully',
      });

      setClaimDialogOpen(false);
      setClaimedBy('');
      fetchLostAndFound();
    } catch (error: any) {
      console.error('Error claiming item:', error);
      toast({
        title: 'Error',
        description: 'Failed to mark item as claimed',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = searchRoom
    ? items.filter(item => 
        item.rooms?.room_number?.toLowerCase().includes(searchRoom.toLowerCase())
      )
    : items;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Pending</Badge>;
      case 'claimed':
        return <Badge className="bg-green-100 text-green-800">Claimed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Package className="h-8 w-8" />
            Lost and Found
          </h2>
          <p className="text-muted-foreground">Track and manage lost items reported by housekeepers</p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full sm:w-[240px] justify-start text-left font-normal">
              <CalendarIcon className="mr-2 h-4 w-4" />
              {format(selectedDate, 'PPP')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Search Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by room number..."
              value={searchRoom}
              onChange={(e) => setSearchRoom(e.target.value)}
              className="flex-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{items.length}</div>
            <p className="text-xs text-muted-foreground">{format(selectedDate, 'MMMM d, yyyy')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Items</CardTitle>
            <Package className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{items.filter(i => i.status === 'pending').length}</div>
            <p className="text-xs text-muted-foreground">Awaiting claim</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Claimed Items</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{items.filter(i => i.status === 'claimed').length}</div>
            <p className="text-xs text-muted-foreground">Successfully claimed</p>
          </CardContent>
        </Card>
      </div>

      {/* Items List */}
      <Card>
        <CardHeader>
          <CardTitle>Lost and Found Items</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No lost and found items for this date
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => (
                <Card key={item.id} className="border-l-4 border-l-primary">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-semibold">
                            Room {item.rooms?.room_number}
                          </Badge>
                          <Badge variant="secondary">{item.rooms?.hotel}</Badge>
                          {getStatusBadge(item.status)}
                        </div>
                        
                        <div>
                          <p className="font-semibold text-foreground">{item.item_description}</p>
                          <p className="text-sm text-muted-foreground">
                            Found by: {item.profiles?.full_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Date: {format(new Date(item.found_date), 'PPP')}
                          </p>
                        </div>

                        {item.notes && (
                          <p className="text-sm text-muted-foreground italic">
                            Notes: {item.notes}
                          </p>
                        )}

                        {item.claimed_by && (
                          <div className="text-sm text-green-600">
                            ✓ Claimed by: {item.claimed_by} on {format(new Date(item.claimed_at!), 'PPP')}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedItem(item);
                            setShowDetailsDialog(true);
                          }}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                        
                        {item.status === 'pending' && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => {
                              setSelectedItem(item);
                              setClaimDialogOpen(true);
                            }}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Claim
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Lost and Found Item Details</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Room Number</Label>
                  <p className="font-semibold">{selectedItem.rooms?.room_number}</p>
                </div>
                <div>
                  <Label>Hotel</Label>
                  <p className="font-semibold">{selectedItem.rooms?.hotel}</p>
                </div>
                <div>
                  <Label>Item Description</Label>
                  <p className="font-semibold">{selectedItem.item_description}</p>
                </div>
                <div>
                  <Label>Status</Label>
                  <div className="mt-1">{getStatusBadge(selectedItem.status)}</div>
                </div>
                <div>
                  <Label>Reported By</Label>
                  <p className="font-semibold">{selectedItem.profiles?.full_name}</p>
                </div>
                <div>
                  <Label>Found Date</Label>
                  <p className="font-semibold">{format(new Date(selectedItem.found_date), 'PPP')}</p>
                </div>
              </div>

              {selectedItem.notes && (
                <div>
                  <Label>Notes</Label>
                  <p className="mt-1 p-3 bg-muted rounded-lg">{selectedItem.notes}</p>
                </div>
              )}

              {selectedItem.claimed_by && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <Label className="text-green-800">Claimed Information</Label>
                  <p className="mt-1 text-green-700">
                    <strong>Claimed by:</strong> {selectedItem.claimed_by}
                  </p>
                  <p className="text-green-700">
                    <strong>Claimed on:</strong> {format(new Date(selectedItem.claimed_at!), 'PPP')}
                  </p>
                </div>
              )}

              {selectedItem.photo_urls && selectedItem.photo_urls.length > 0 && (
                <div>
                  <Label className="mb-2 block">Photos</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {selectedItem.photo_urls.map((photoUrl, index) => (
                      <a
                        key={index}
                        href={photoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <img
                          src={photoUrl}
                          alt={`Lost item ${index + 1}`}
                          className="w-full h-32 object-cover rounded-lg border hover:opacity-80 transition-opacity"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Claim Dialog */}
      <Dialog open={claimDialogOpen} onOpenChange={setClaimDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Item as Claimed</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Item Description</Label>
              <p className="font-semibold">{selectedItem?.item_description}</p>
            </div>
            <div>
              <Label htmlFor="claimed_by">Claimed By *</Label>
              <Input
                id="claimed_by"
                value={claimedBy}
                onChange={(e) => setClaimedBy(e.target.value)}
                placeholder="Enter name of person claiming the item"
                required
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setClaimDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleClaimItem} disabled={!claimedBy.trim() || loading}>
                {loading ? 'Processing...' : 'Confirm Claim'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
