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
import { useAuth } from '@/hooks/useAuth';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Calendar as CalendarIcon, Package, Search, Eye, CheckCircle, Trash2, Plus } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { LostAndFoundDialog } from './LostAndFoundDialog';

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
  const { user, profile } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [items, setItems] = useState<LostAndFoundItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchRoom, setSearchRoom] = useState('');
  const [selectedItem, setSelectedItem] = useState<LostAndFoundItem | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [claimedBy, setClaimedBy] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);

  const canDelete = (profile?.role && ['admin'].includes(profile.role)) || profile?.is_super_admin;
  const canAddItems = profile?.role && ['admin', 'manager', 'housekeeping_manager'].includes(profile.role);

  useEffect(() => {
    fetchLostAndFound();
  }, [selectedDate]);

  const fetchLostAndFound = async () => {
    setLoading(true);
    try {
      const startDate = startOfDay(selectedDate);
      const endDate = endOfDay(selectedDate);

      console.log('Fetching lost and found for date:', format(selectedDate, 'yyyy-MM-dd'));

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

      if (error) {
        console.error('Query error:', error);
        throw error;
      }
      
      console.log('Found items:', data?.length || 0, data);
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
        description: 'Item marked as claimed',
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

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Are you sure you want to delete this lost and found item?')) return;
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('lost_and_found')
        .delete()
        .eq('id', itemId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Lost and found item deleted successfully',
      });

      fetchLostAndFound();
    } catch (error: any) {
      console.error('Error deleting item:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete item',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = searchRoom
    ? items.filter(item => item.rooms?.room_number.includes(searchRoom))
    : items;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Lost & Found Management
            </CardTitle>
            {canAddItems && (
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-6">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[240px] justify-start">
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

            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by room number..."
                value={searchRoom}
                onChange={(e) => setSearchRoom(e.target.value)}
                className="w-[200px]"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item) => (
                <Card key={item.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                  {item.photo_urls && item.photo_urls.length > 0 && (
                    <div className="aspect-video relative bg-gray-100">
                      <img
                        src={item.photo_urls[0]}
                        alt={item.item_description}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/placeholder.svg';
                        }}
                      />
                      <Badge 
                        className={`absolute top-2 left-2 ${
                          item.status === 'claimed' 
                            ? 'bg-green-500' 
                            : item.status === 'pending'
                            ? 'bg-yellow-500'
                            : 'bg-blue-500'
                        }`}
                      >
                        {item.status}
                      </Badge>
                    </div>
                  )}
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between">
                        <h3 className="font-semibold line-clamp-2">{item.item_description}</h3>
                      </div>
                      
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div className="flex items-center justify-between">
                          <span>Room:</span>
                          <Badge variant="outline">{item.rooms?.room_number || 'N/A'}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Hotel:</span>
                          <span className="text-xs">{item.rooms?.hotel || 'N/A'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Found:</span>
                          <span className="text-xs">{format(new Date(item.found_date), 'MMM dd, yyyy')}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>By:</span>
                          <span className="text-xs">{item.profiles?.full_name || 'Unknown'}</span>
                        </div>
                      </div>

                      {item.notes && (
                        <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
                          {item.notes}
                        </div>
                      )}

                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedItem(item);
                            setShowDetailsDialog(true);
                          }}
                          className="flex-1"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                        {item.status === 'pending' && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedItem(item);
                              setClaimDialogOpen(true);
                            }}
                            className="flex-1"
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Claim
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteItem(item.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {filteredItems.length === 0 && !loading && (
                <div className="col-span-full text-center py-8 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No lost and found items for the selected date</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Lost & Found Item Details</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <strong>Item:</strong> {selectedItem.item_description}
                </div>
                <div>
                  <strong>Room:</strong> {selectedItem.rooms?.room_number || 'N/A'}
                </div>
                <div>
                  <strong>Hotel:</strong> {selectedItem.rooms?.hotel || 'N/A'}
                </div>
                <div>
                  <strong>Status:</strong> <Badge>{selectedItem.status}</Badge>
                </div>
                <div>
                  <strong>Found Date:</strong> {format(new Date(selectedItem.found_date), 'MMM dd, yyyy')}
                </div>
                <div>
                  <strong>Reported by:</strong> {selectedItem.profiles?.full_name || 'Unknown'}
                </div>
                {selectedItem.claimed_at && (
                  <>
                    <div>
                      <strong>Claimed at:</strong> {format(new Date(selectedItem.claimed_at), 'MMM dd, yyyy HH:mm')}
                    </div>
                    <div>
                      <strong>Claimed by:</strong> {selectedItem.claimed_by}
                    </div>
                  </>
                )}
              </div>

              {selectedItem.notes && (
                <div className="bg-muted p-3 rounded">
                  <strong>Notes:</strong> {selectedItem.notes}
                </div>
              )}

              {selectedItem.photo_urls && selectedItem.photo_urls.length > 0 && (
                <div className="space-y-2">
                  <strong>Photos:</strong>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {selectedItem.photo_urls.map((url, index) => (
                      <a key={index} href={url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={url}
                          alt={`Item photo ${index + 1}`}
                          className="w-full h-32 object-cover rounded border hover:opacity-80"
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
              <Label htmlFor="claimed_by">Claimed By (Guest Name/Room)</Label>
              <Input
                id="claimed_by"
                value={claimedBy}
                onChange={(e) => setClaimedBy(e.target.value)}
                placeholder="Enter guest name or room number"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setClaimDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleClaimItem} disabled={!claimedBy.trim() || loading}>
                Mark as Claimed
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Item Dialog - for managers to add non-room-specific items */}
      {showAddDialog && (
        <LostAndFoundDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          roomNumber="N/A"
          roomId=""
          assignmentId=""
          onItemReported={() => {
            fetchLostAndFound();
            setShowAddDialog(false);
          }}
        />
      )}
    </div>
  );
}