import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Briefcase, User, MapPin, Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { format } from 'date-fns';

interface GeneralTask {
  id: string;
  task_name: string;
  task_description: string | null;
  task_type: string;
  assigned_to: string;
  assigned_by: string;
  hotel: string;
  status: string;
  priority: number;
  estimated_duration: number | null;
  assigned_date: string;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  profiles: {
    full_name: string;
    nickname: string;
  };
}

interface Staff {
  id: string;
  full_name: string;
  nickname: string;
}

export function GeneralTasksManagement() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<GeneralTask[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [hotels, setHotels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  
  const [newTask, setNewTask] = useState({
    task_name: '',
    task_description: '',
    task_type: 'lobby_cleaning',
    assigned_to: '',
    hotel: '',
    priority: 1,
    estimated_duration: 60,
  });

  useEffect(() => {
    fetchCurrentUser();
    fetchTasks();
    fetchStaff();
    fetchHotels();
  }, []);

  const fetchCurrentUser = async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      setCurrentUserId(data.user.id);
    }
  };

  const fetchHotels = async () => {
    try {
      const { data, error } = await supabase
        .from('hotels')
        .select('*')
        .order('name');
      if (error) throw error;
      setHotels(data || []);
    } catch (error) {
      console.error('Error fetching hotels:', error);
    }
  };

  const fetchStaff = async () => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      const { data, error } = await supabase.rpc('get_assignable_staff_secure', {
        requesting_user_role: profile?.role
      });

      if (error) throw error;
      setStaff(data || []);
    } catch (error) {
      console.error('Error fetching staff:', error);
    }
  };

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('general_tasks')
        .select(`
          *,
          profiles!assigned_to (
            full_name,
            nickname
          )
        `)
        .order('assigned_date', { ascending: false })
        .order('priority', { ascending: true });

      if (error) throw error;
      setTasks((data as any) || []);
    } catch (error) {
      console.error('Error fetching tasks:', error);
      toast.error('Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.from('general_tasks').insert({
        task_name: newTask.task_name,
        task_description: newTask.task_description || null,
        task_type: newTask.task_type,
        assigned_to: newTask.assigned_to,
        assigned_by: currentUserId,
        hotel: newTask.hotel,
        priority: newTask.priority,
        estimated_duration: newTask.estimated_duration,
        assigned_date: new Date().toISOString().split('T')[0],
        status: 'assigned'
      });

      if (error) throw error;

      toast.success('Task created successfully');
      setCreateDialogOpen(false);
      setNewTask({
        task_name: '',
        task_description: '',
        task_type: 'lobby_cleaning',
        assigned_to: '',
        hotel: '',
        priority: 1,
        estimated_duration: 60,
      });
      fetchTasks();
    } catch (error: any) {
      console.error('Error creating task:', error);
      toast.error('Failed to create task: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'assigned':
        return 'bg-yellow-100 text-yellow-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const taskTypes = [
    { value: 'lobby_cleaning', label: 'Lobby Cleaning' },
    { value: 'guest_toilet_cleaning', label: 'Guest Toilet Cleaning' },
    { value: 'common_area_cleaning', label: 'Common Area Cleaning' },
    { value: 'corridor_cleaning', label: 'Corridor Cleaning' },
    { value: 'elevator_cleaning', label: 'Elevator Cleaning' },
    { value: 'staircase_cleaning', label: 'Staircase Cleaning' },
    { value: 'restaurant_cleaning', label: 'Restaurant Cleaning' },
    { value: 'gym_cleaning', label: 'Gym Cleaning' },
    { value: 'pool_area_cleaning', label: 'Pool Area Cleaning' },
    { value: 'other', label: 'Other Task' },
  ];

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Briefcase className="h-6 w-6" />
            General Tasks
          </h2>
          <p className="text-muted-foreground mt-1">
            Manage non-room cleaning tasks for housekeeping staff
          </p>
        </div>

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Task
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Task</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="task_name">Task Name *</Label>
                <Input
                  id="task_name"
                  value={newTask.task_name}
                  onChange={(e) => setNewTask({ ...newTask, task_name: e.target.value })}
                  placeholder="e.g., Clean main lobby area"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="task_type">Task Type *</Label>
                <Select value={newTask.task_type} onValueChange={(value) => setNewTask({ ...newTask, task_type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {taskTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="task_description">Description</Label>
                <Textarea
                  id="task_description"
                  value={newTask.task_description}
                  onChange={(e) => setNewTask({ ...newTask, task_description: e.target.value })}
                  placeholder="Detailed task description..."
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="assigned_to">Assign To *</Label>
                  <Select value={newTask.assigned_to} onValueChange={(value) => setNewTask({ ...newTask, assigned_to: value })} required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select staff member" />
                    </SelectTrigger>
                    <SelectContent>
                      {staff.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hotel">Hotel *</Label>
                  <Select value={newTask.hotel} onValueChange={(value) => setNewTask({ ...newTask, hotel: value })} required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select hotel" />
                    </SelectTrigger>
                    <SelectContent>
                      {hotels.map((hotel) => (
                        <SelectItem key={hotel.id} value={hotel.name}>
                          {hotel.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="priority">Priority</Label>
                  <Select 
                    value={newTask.priority.toString()} 
                    onValueChange={(value) => setNewTask({ ...newTask, priority: parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">High Priority</SelectItem>
                      <SelectItem value="2">Medium Priority</SelectItem>
                      <SelectItem value="3">Low Priority</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="estimated_duration">Est. Duration (minutes)</Label>
                  <Input
                    id="estimated_duration"
                    type="number"
                    value={newTask.estimated_duration}
                    onChange={(e) => setNewTask({ ...newTask, estimated_duration: parseInt(e.target.value) })}
                    min="15"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Task'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : tasks.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              No Tasks Created
            </h3>
            <p className="text-muted-foreground">
              Create your first general task for housekeeping staff
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {tasks.map((task) => (
            <Card key={task.id}>
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  <CardTitle className="text-xl">{task.task_name}</CardTitle>
                  <Badge className={getStatusColor(task.status)}>
                    {task.status.replace('_', ' ').toUpperCase()}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Assigned To
                      </p>
                      <p className="text-lg font-semibold">
                        {task.profiles?.full_name || 'Unknown'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Hotel
                      </p>
                      <p className="text-lg font-semibold">{task.hotel}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <CalendarIcon className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Assigned Date
                      </p>
                      <p className="text-lg font-semibold">
                        {format(new Date(task.assigned_date), 'PPP')}
                      </p>
                    </div>
                  </div>
                </div>

                {task.task_description && (
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <p className="text-sm text-foreground">{task.task_description}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    Type: {taskTypes.find(t => t.value === task.task_type)?.label || task.task_type}
                  </Badge>
                  {task.estimated_duration && (
                    <Badge variant="outline">
                      Est. {task.estimated_duration} mins
                    </Badge>
                  )}
                  <Badge variant="outline">
                    Priority {task.priority}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
