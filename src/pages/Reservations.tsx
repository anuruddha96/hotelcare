import { Navigate, useParams } from 'react-router-dom';

export default function Reservations() {
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  return <Navigate to={`/${organizationSlug || 'rdhotels'}/reception`} replace />;
}
