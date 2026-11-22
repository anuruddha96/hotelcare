-- Write the certificate and its private key as one transaction. Lock the same
-- settings row for both operations so simultaneous requests cannot split a pair.
create or replace function public.ntak_save_pending_csr(
  _hotel_id text, _registration text, _csr text, _key text, _fingerprint text
) returns text language plpgsql set search_path = '' as $$
declare current_settings public.ntak_settings;
begin
  select * into strict current_settings from public.ntak_settings where hotel_id = _hotel_id for update;
  if current_settings.registration_number is distinct from _registration then
    raise exception 'Registration changed';
  end if;
  if current_settings.pending_csr_pem is not null then return current_settings.pending_csr_pem; end if;
  perform public.ntak_put_secret(_hotel_id, 'pending_key', _key);
  update public.ntak_settings set pending_csr_pem = _csr, pending_spki_sha256 = _fingerprint,
    pending_csr_created_at = now() where hotel_id = _hotel_id;
  return _csr;
end $$;

create or replace function public.ntak_install_certificate(
  _hotel_id text, _registration text, _cert text, _key text, _use_pending boolean,
  _subject jsonb, _serial text, _expires timestamptz
) returns void language plpgsql set search_path = '' as $$
declare current_settings public.ntak_settings;
begin
  select * into strict current_settings from public.ntak_settings where hotel_id = _hotel_id for update;
  if current_settings.registration_number is distinct from _registration or
    (_use_pending and public.ntak_get_secret(_hotel_id, 'pending_key') is distinct from _key) then
    raise exception 'Registration or pending key changed';
  end if;
  perform public.ntak_put_secret(_hotel_id, 'cert', _cert);
  perform public.ntak_put_secret(_hotel_id, 'key', _key);
  perform public.ntak_put_secret(_hotel_id, 'pending_key', '');
  update public.ntak_settings set cert_subject = _subject, cert_serial = _serial,
    cert_not_after = _expires, cert_uploaded_at = now(), pending_csr_pem = null,
    pending_csr_created_at = null, pending_spki_sha256 = null,
    sending_blocked_reason = case when sending_blocked_reason ~* 'certificate|tanúsítvány|tanusitvany'
      then null else sending_blocked_reason end where hotel_id = _hotel_id;
end $$;

revoke all on function public.ntak_save_pending_csr(text,text,text,text,text),
  public.ntak_install_certificate(text,text,text,text,boolean,jsonb,text,timestamptz) from public, anon, authenticated;
grant execute on function public.ntak_save_pending_csr(text,text,text,text,text),
  public.ntak_install_certificate(text,text,text,text,boolean,jsonb,text,timestamptz) to service_role;
