import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Camera, AlertTriangle, Shirt, Image as ImageIcon, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface CompletionDataViewProps {
  assignmentId: string;
  roomId: string;
  assignmentDate: string;
  housekeeperId: string;
}

interface DirtyLinenItem {
  id: string;
  linen_item_id: string;
  count: number;
  dirty_linen_items: {
    display_name: string;
  };
}

interface DNDPhoto {
  id: string;
  photo_url: string;
  notes: string | null;
  marked_at: string;
}

interface MinibarUsage {
  id: string;
  quantity_used: number;
  usage_date: string;
  minibar_items: {
    name: string;
    price: number;
  };
}

interface MaintenanceIssue {
  id: string;
  issue_description: string;
  photo_urls: string[];
  priority: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface LostAndFoundItem {
  id: string;
  item_description: string;
  photo_urls: string[];
  notes: string | null;
  status: string;
  found_date: string;
}

export function CompletionDataView({ 
  assignmentId, 
  roomId, 
  assignmentDate,
  housekeeperId
}: CompletionDataViewProps) {
  const { t } = useTranslation();
  const [completionPhotos, setCompletionPhotos] = useState<any[]>([]);
  const [dndPhotos, setDndPhotos] = useState<DNDPhoto[]>([]);
  const [dirtyLinen, setDirtyLinen] = useState<DirtyLinenItem[]>([]);
  const [minibarUsage, setMinibarUsage] = useState<MinibarUsage[]>([]);
  const [maintenanceIssues, setMaintenanceIssues] = useState<MaintenanceIssue[]>([]);
  const [lostAndFoundItems, setLostAndFoundItems] = useState<LostAndFoundItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCompletionData();
  }, [assignmentId, roomId, assignmentDate, housekeeperId]);

  const fetchCompletionData = async () => {
    setLoading(true);
    try {
      // Fetch completion photos from assignment
      const { data: assignmentData, error: assignmentError } = await supabase
        .from('room_assignments')
        .select('completion_photos')
        .eq('id', assignmentId)
        .single();

      if (assignmentError) {
        console.error('Error fetching completion photos:', assignmentError);
      }
      
      if (assignmentData) {
        const photos = assignmentData.completion_photos || [];
        console.log('Completion photos found:', photos.length);
        
        // Category mapping for display names
        const categoryMap: Record<string, string> = {
          trash_bin: 'Trash Bin',
          bathroom: 'Bathroom',
          bed: 'Bed',
          minibar: 'Minibar',
          tea_coffee_table: 'Tea/Coffee Table'
        };
        
        // Parse photos - extract category from filename or try JSON parsing
        const parsedPhotos = photos.map((photo: any) => {
          try {
            const parsed = JSON.parse(photo);
            return parsed; // {url, category, categoryName}
          } catch {
            // Extract category from filename (format: category_timestamp_random.jpg)
            let categoryName = 'Room Photo';
            const url = typeof photo === 'string' ? photo : photo.url || photo;
            const filename = url.split('/').pop() || '';
            
            // Try to match category from filename
            for (const [category, displayName] of Object.entries(categoryMap)) {
              if (filename.startsWith(category + '_')) {
                categoryName = displayName;
                break;
              }
            }
            
            return { url, categoryName };
          }
        });
        
        setCompletionPhotos(parsedPhotos);
      }

      // Fetch ONLY DND photos attached to this specific assignment
      const { data: dndData, error: dndError } = await supabase
        .from('dnd_photos')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('marked_at', { ascending: false });

      if (dndError) {
        console.error('Error fetching DND photos:', dndError);
      }
      
      if (dndData) {
        console.log('DND photos found for this assignment:', dndData.length);
        setDndPhotos(dndData);
      }

      // Fetch dirty linen counts
      const { data: linenData, error: linenError } = await supabase
        .from('dirty_linen_counts')
        .select(`
          id,
          linen_item_id,
          count,
          dirty_linen_items (
            display_name
          )
        `)
        .eq('housekeeper_id', housekeeperId)
        .eq('room_id', roomId)
        .eq('work_date', assignmentDate);

      if (linenError) {
        console.error('Error fetching dirty linen:', linenError);
      }
      
      if (linenData) {
        console.log('Dirty linen records found:', linenData.length);
        setDirtyLinen(linenData as any);
      }

      // Fetch ONLY minibar usage for TODAY's assignment (not historical data)
      const { data: minibarData, error: minibarError } = await supabase
        .from('room_minibar_usage')
        .select(`
          id,
          quantity_used,
          usage_date,
          minibar_items (
            name,
            price
          )
        `)
        .eq('room_id', roomId)
        .eq('is_cleared', false)
        .gte('usage_date', `${assignmentDate}T00:00:00`)
        .lte('usage_date', `${assignmentDate}T23:59:59`);

      if (minibarError) {
        console.error('Error fetching minibar usage:', minibarError);
      }
      
      if (minibarData) {
        console.log('Minibar usage found:', minibarData.length);
        setMinibarUsage(minibarData as any);
      }

      // Fetch maintenance issues for this assignment
      const { data: maintenanceData, error: maintenanceError } = await supabase
        .from('maintenance_issues')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: false });

      if (maintenanceError) {
        console.error('Error fetching maintenance issues:', maintenanceError);
      }
      
      if (maintenanceData) {
        console.log('Maintenance issues found:', maintenanceData.length);
        setMaintenanceIssues(maintenanceData);
      }

      // Fetch lost and found items for this assignment
      const { data: lostFoundData, error: lostFoundError } = await supabase
        .from('lost_and_found')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('found_date', { ascending: false });

      if (lostFoundError) {
        console.error('Error fetching lost and found:', lostFoundError);
      }
      
      if (lostFoundData) {
        console.log('Lost and found items found:', lostFoundData.length);
        setLostAndFoundItems(lostFoundData);
      }
    } catch (error) {
      console.error('Error fetching completion data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    );
  }

  const hasData = completionPhotos.length > 0 || dndPhotos.length > 0 || dirtyLinen.length > 0 || minibarUsage.length > 0 || maintenanceIssues.length > 0 || lostAndFoundItems.length > 0;

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-foreground flex items-center gap-2">
        <ImageIcon className="h-4 w-4" />
        Captured Data During Cleaning
      </h4>

      {!hasData && (
        <Card className="p-4 bg-amber-50 border-amber-200">
          <p className="text-sm text-amber-800 text-center">
            ⚠️ No photos or data captured during cleaning. Please verify with housekeeper.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Daily Completion Photos */}
        {completionPhotos.length > 0 && (
          <Dialog>
            <DialogTrigger asChild>
              <Card className="p-3 hover:shadow-md transition-shadow cursor-pointer bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Camera className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-900">Room Photos</span>
                  </div>
                  <Badge variant="secondary" className="bg-blue-200 text-blue-800">
                    {completionPhotos.length}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-blue-700">
                  <span>View photos</span>
                  <ChevronRight className="h-3 w-3" />
                </div>
              </Card>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Daily Completion Photos</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {completionPhotos.map((photo, index) => (
                  <div key={index} className="space-y-1">
                    <a 
                      href={photo.url || photo} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <img
                        src={photo.url || photo}
                        alt={photo.categoryName || `Completion ${index + 1}`}
                        className="w-full h-32 object-cover rounded-lg border hover:opacity-80 transition-opacity"
                      />
                    </a>
                    {photo.categoryName && (
                      <p className="text-xs text-center font-medium text-muted-foreground">
                        {photo.categoryName}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* DND Photos */}
        {dndPhotos.length > 0 && (
          <Dialog>
            <DialogTrigger asChild>
              <Card className="p-3 hover:shadow-md transition-shadow cursor-pointer bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-600" />
                    <span className="text-sm font-medium text-orange-900">DND Photos</span>
                  </div>
                  <Badge variant="secondary" className="bg-orange-200 text-orange-800">
                    {dndPhotos.length}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-orange-700">
                  <span>View DND evidence</span>
                  <ChevronRight className="h-3 w-3" />
                </div>
              </Card>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>DND Photos</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {dndPhotos.map((dnd) => (
                  <Card key={dnd.id} className="p-4">
                    <div className="space-y-3">
                      <a 
                        href={dnd.photo_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <img
                          src={dnd.photo_url}
                          alt="DND photo"
                          className="w-full h-48 object-cover rounded-lg border hover:opacity-80 transition-opacity"
                        />
                      </a>
                      {dnd.notes && (
                        <div className="text-sm text-muted-foreground">
                          <strong>Notes:</strong> {dnd.notes}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        Marked at: {new Date(dnd.marked_at).toLocaleString()}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Dirty Linen */}
        {dirtyLinen.length > 0 && (
          <Dialog>
            <DialogTrigger asChild>
              <Card className="p-3 hover:shadow-md transition-shadow cursor-pointer bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Shirt className="h-4 w-4 text-purple-600" />
                    <span className="text-sm font-medium text-purple-900">Dirty Linen</span>
                  </div>
                  <Badge variant="secondary" className="bg-purple-200 text-purple-800">
                    {dirtyLinen.reduce((sum, item) => sum + item.count, 0)}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-purple-700">
                  <span>View collected items</span>
                  <ChevronRight className="h-3 w-3" />
                </div>
              </Card>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dirty Linen Collected</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                {dirtyLinen.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <span className="font-medium">{item.dirty_linen_items.display_name}</span>
                    <Badge variant="outline">{item.count} pcs</Badge>
                  </div>
                ))}
                <div className="pt-3 border-t">
                  <div className="flex items-center justify-between font-semibold">
                    <span>Total Items:</span>
                    <span>{dirtyLinen.reduce((sum, item) => sum + item.count, 0)} pieces</span>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Minibar Usage */}
        {minibarUsage.length > 0 && (
          <Dialog>
            <DialogTrigger asChild>
              <Card className="p-3 hover:shadow-md transition-shadow cursor-pointer bg-gradient-to-br from-green-50 to-green-100 border-green-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🍷</span>
                    <span className="text-sm font-medium text-green-900">Minibar</span>
                  </div>
                  <Badge variant="secondary" className="bg-green-200 text-green-800">
                    €{minibarUsage.reduce((sum, item) => sum + (item.quantity_used * item.minibar_items.price), 0).toFixed(2)}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-green-700">
                  <span>View consumption</span>
                  <ChevronRight className="h-3 w-3" />
                </div>
              </Card>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Minibar Consumption</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                {minibarUsage.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex-1">
                      <span className="font-medium">{item.minibar_items.name}</span>
                      <div className="text-sm text-muted-foreground">
                        €{item.minibar_items.price.toFixed(2)} × {item.quantity_used}
                      </div>
                    </div>
                    <Badge variant="outline" className="font-semibold">
                      €{(item.minibar_items.price * item.quantity_used).toFixed(2)}
                    </Badge>
                  </div>
                ))}
                <div className="pt-3 border-t">
                  <div className="flex items-center justify-between font-semibold text-lg">
                    <span>Total:</span>
                    <span className="text-green-600">
                      €{minibarUsage.reduce((sum, item) => sum + (item.quantity_used * item.minibar_items.price), 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Lost and Found Items */}
        {lostAndFoundItems.length > 0 && (
          <Dialog>
            <DialogTrigger asChild>
              <Card className="p-3 hover:shadow-md transition-shadow cursor-pointer bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-300 border-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📦</span>
                    <span className="text-sm font-medium text-yellow-900">Lost & Found</span>
                  </div>
                  <Badge variant="secondary" className="bg-yellow-200 text-yellow-800">
                    {lostAndFoundItems.length}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-yellow-700">
                  <span>Review items</span>
                  <ChevronRight className="h-3 w-3" />
                </div>
              </Card>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Lost & Found Items</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {lostAndFoundItems.map((item) => (
                  <Card key={item.id} className="p-4 border-yellow-200">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold text-lg">{item.item_description}</h4>
                          <Badge variant="outline" className="mt-1">
                            {item.status}
                          </Badge>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {new Date(item.found_date).toLocaleDateString()}
                        </span>
                      </div>
                      
                      {item.photo_urls && item.photo_urls.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {item.photo_urls.map((photoUrl, idx) => (
                            <a 
                              key={idx} 
                              href={photoUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                            >
                              <img
                                src={photoUrl}
                                alt={`Lost item ${idx + 1}`}
                                className="w-full h-24 object-cover rounded border hover:opacity-80"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                      
                      {item.notes && (
                        <div className="text-sm bg-muted p-2 rounded">
                          <strong>Notes:</strong> {item.notes}
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Maintenance Issues - Prominently Displayed */}
        {maintenanceIssues.length > 0 && (
          <Dialog>
            <DialogTrigger asChild>
              <Card className="p-3 hover:shadow-md transition-shadow cursor-pointer bg-gradient-to-br from-red-50 to-red-100 border-red-300 border-2 shadow-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <span className="text-sm font-bold text-red-900">⚠️ Maintenance</span>
                  </div>
                  <Badge variant="destructive" className="bg-red-600 text-white pulse-animation">
                    {maintenanceIssues.length}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-red-700 font-semibold">
                  <span>REQUIRES ATTENTION</span>
                  <ChevronRight className="h-3 w-3" />
                </div>
              </Card>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Maintenance Issues Reported
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {maintenanceIssues.map((issue) => (
                  <Card key={issue.id} className="border-2 border-destructive/30 bg-destructive/5">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge className={
                          issue.priority === 'urgent' || issue.priority === 'high'
                            ? 'bg-red-600 text-white'
                            : issue.priority === 'medium'
                            ? 'bg-yellow-500 text-white'
                            : 'bg-green-500 text-white'
                        }>
                          {issue.priority.toUpperCase()} PRIORITY
                        </Badge>
                        <Badge variant="outline">
                          {issue.status.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </div>
                      
                      <div className="p-3 bg-white rounded-lg border border-destructive/20">
                        <p className="font-semibold text-destructive mb-1">Issue Description:</p>
                        <p className="text-foreground">{issue.issue_description}</p>
                        {issue.notes && (
                          <p className="text-muted-foreground mt-2 text-sm">
                            Notes: {issue.notes}
                          </p>
                        )}
                      </div>

                      {issue.photo_urls && issue.photo_urls.length > 0 && (
                        <div className="space-y-2">
                          <p className="font-semibold text-sm">📷 Photos ({issue.photo_urls.length}):</p>
                          <div className="grid grid-cols-3 gap-2">
                            {issue.photo_urls.map((url, idx) => (
                              <img
                                key={idx}
                                src={url}
                                alt={`Maintenance ${idx + 1}`}
                                className="w-full h-24 object-cover rounded-lg border-2 border-destructive/30"
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground">
                        Reported at: {new Date(issue.created_at).toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
