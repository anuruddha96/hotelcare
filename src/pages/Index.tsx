import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { HotelSelectionScreen } from '@/components/dashboard/HotelSelectionScreen';
import { isExecutiveRole, isReceptionRole } from '@/lib/roleAccess';
import Reputation from '@/pages/Reputation';

const MANAGER_ROLES = ['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'];
const getLocalDateKey=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const readHotelSelectedForToday=(userId?:string)=>{const k=getLocalDateKey();try{if(userId&&localStorage.getItem(`hotel_selected_date:${userId}`)===k)return true;if(localStorage.getItem('hotel_selected_date')===k)return true;if(sessionStorage.getItem('hotel_selected')==='true')return true;}catch{}return false;};

const Index=()=>{
 const {user,profile,loading}=useAuth();
 const {organizationSlug}=useParams<{organizationSlug:string}>();
 const [searchParams]=useSearchParams();
 const hasExplicitTab=useRef(!!new URLSearchParams(window.location.search).get('tab'));
 if(searchParams.get('tab'))hasExplicitTab.current=true;
 const [hotelSelected,setHotelSelected]=useState(()=>readHotelSelectedForToday());
 useEffect(()=>{if(!user?.id||!profile)return;if(readHotelSelectedForToday(user.id)){if(!hotelSelected)setHotelSelected(true);return;}if(MANAGER_ROLES.includes(profile.role)&&profile.assigned_hotel){const k=getLocalDateKey();try{localStorage.setItem(`hotel_selected_date:${user.id}`,k);localStorage.setItem('hotel_selected_date',k);sessionStorage.setItem('hotel_selected','true');}catch{}setHotelSelected(true);}},[user?.id,profile?.role,profile?.assigned_hotel,hotelSelected]);
 useEffect(()=>{if(profile?.role==='breakfast_staff'&&!window.location.pathname.startsWith('/bb'))window.location.replace('/bb');},[profile?.role]);
 if(profile&&isReceptionRole(profile.role))return <Navigate to={`/${organizationSlug||'rdhotels'}/reception`} replace/>;
 if(profile&&isExecutiveRole(profile.role)&&!hasExplicitTab.current)return <Navigate to={`/${organizationSlug||profile.organization_slug||'rdhotels'}/revenue`} replace/>;
 if(loading)return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"/></div>;
 if(!user)return <Navigate to={`/${organizationSlug||'rdhotels'}/auth`} replace/>;
 if(profile?.role==='breakfast_staff')return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"/></div>;
 if(searchParams.get('tab')==='reputation')return <Reputation/>;
 if(profile&&MANAGER_ROLES.includes(profile.role)&&!hotelSelected&&!profile.assigned_hotel)return <HotelSelectionScreen onHotelSelected={()=>setHotelSelected(true)}/>;
 return <div className="min-h-screen bg-background overflow-x-hidden"><Header/><PMSNavigation/><Dashboard/></div>;
};
export default Index;
