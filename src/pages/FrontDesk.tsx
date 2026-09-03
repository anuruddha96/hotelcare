import { Navigate, useParams } from 'react-router-dom';

export default function FrontDesk() {
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  return <Navigate to={`/${organizationSlug || 'rdhotels'}/reception`} replace />;
}
