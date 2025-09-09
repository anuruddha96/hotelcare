import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, AlertTriangle, Wrench, Settings } from 'lucide-react';

interface RoomStatusData {
  clean: number;
  dirty: number;
  maintenance: number;
  out_of_order: number;
}

interface RoomStatusOverviewProps {
  statusData: RoomStatusData;
  onStatusClick: (status: string) => void;
  activeFilter?: string;
}

export function RoomStatusOverview({ statusData, onStatusClick, activeFilter }: RoomStatusOverviewProps) {
  const statusCards = [
    {
      key: 'clean',
      title: 'Clean',
      subtitle: 'Ready rooms',
      count: statusData.clean,
      icon: CheckCircle2,
      bgColor: 'bg-gradient-to-br from-emerald-50 to-emerald-100/80',
      iconBg: 'bg-emerald-500/10',
      iconColor: 'text-emerald-600',
      borderColor: 'border-emerald-200',
      hoverColor: 'hover:from-emerald-100 hover:to-emerald-200/80'
    },
    {
      key: 'dirty',
      title: 'Dirty',
      subtitle: 'Need cleaning',
      count: statusData.dirty,
      icon: AlertTriangle,
      bgColor: 'bg-gradient-to-br from-orange-50 to-orange-100/80',
      iconBg: 'bg-orange-500/10',
      iconColor: 'text-orange-600',
      borderColor: 'border-orange-200',
      hoverColor: 'hover:from-orange-100 hover:to-orange-200/80'
    },
    {
      key: 'maintenance',
      title: 'Maintenance',
      subtitle: 'Under repair',
      count: statusData.maintenance,
      icon: Wrench,
      bgColor: 'bg-gradient-to-br from-blue-50 to-blue-100/80',
      iconBg: 'bg-blue-500/10',
      iconColor: 'text-blue-600',
      borderColor: 'border-blue-200',
      hoverColor: 'hover:from-blue-100 hover:to-blue-200/80'
    },
    {
      key: 'out_of_order',
      title: 'Out Of Order',
      subtitle: 'Not available',
      count: statusData.out_of_order,
      icon: Settings,
      bgColor: 'bg-gradient-to-br from-gray-50 to-gray-100/80',
      iconBg: 'bg-gray-500/10',
      iconColor: 'text-gray-600',
      borderColor: 'border-gray-200',
      hoverColor: 'hover:from-gray-100 hover:to-gray-200/80'
    }
  ];

  return (
    <div className="bg-card rounded-lg border shadow-sm p-4 sm:p-6">
      <div className="mb-6">
        <h3 className="text-xl font-semibold text-foreground mb-2">Room Status Overview</h3>
        <p className="text-sm text-muted-foreground">Current status of all rooms</p>
      </div>
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {statusCards.map((status) => {
          const Icon = status.icon;
          const isActive = activeFilter === status.key;
          
          return (
            <Card
              key={status.key}
              className={`
                cursor-pointer transition-all duration-300 border-2 
                aspect-square sm:aspect-square lg:aspect-[4/3]
                ${status.bgColor} ${status.borderColor} ${status.hoverColor}
                hover:shadow-lg hover:scale-[1.02] active:scale-95
                ${isActive ? 'ring-2 ring-primary shadow-lg scale-[1.02]' : ''}
              `}
              onClick={() => onStatusClick(status.key)}
            >
              <CardContent className="p-3 sm:p-4 lg:p-3 flex flex-col justify-between h-full">
                <div className="flex flex-col space-y-2">
                  {/* Icon */}
                  <div className={`
                    w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center
                    ${status.iconBg} ${status.iconColor}
                  `}>
                    <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
                  </div>
                  
                  {/* Content */}
                  <div className="space-y-1">
                    <h4 className="font-semibold text-sm sm:text-lg text-foreground leading-tight">
                      {status.title}
                    </h4>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {status.subtitle}
                    </p>
                  </div>
                </div>
                
                {/* Count */}
                <div className="flex items-end justify-between mt-auto">
                  <span className="text-2xl sm:text-3xl font-bold text-foreground">
                    {status.count}
                  </span>
                  <span className="text-xs sm:text-sm text-muted-foreground font-medium">
                    rooms
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}