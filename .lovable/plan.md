**Findings**
- Previo XML docs say the API key must be sent in the HTTP header: `Authorization: ApiKey {apikey}`.
- The XML body should contain the request params only, e.g. `<request><hotId>...</hotId></request>`.
- Our code currently tries `<apiKey>`, `<login>`, `<password>`, duplicated login/password, and a non-documented `Api-Key` header. It does **not** try the documented `Authorization: ApiKey ...` XML header.
- The REST docs also use the same header format: `Authorization: ApiKey {apikey}` against `https://api.previo.app`, not Basic Auth with `info@hotelcare.app:key`.
- So the API user email is likely just the account/contact Previo assigned the key to; it should not be sent as login/password for these documented endpoints.

**Exact access format to use**
```http
POST https://api.previo.app/x1/hotel/getRoomKinds
Content-Type: application/xml
Authorization: ApiKey YOUR_PREVIO_API_KEY

<request>
  <hotId>YOUR_PREVIO_HOTEL_ID</hotId>
</request>
```

For the listed XML endpoints:
```text
Hotel.searchReservations -> https://api.previo.app/x1/hotel/searchReservations
Hotel.getRoomKinds       -> https://api.previo.app/x1/hotel/getRoomKinds
Hotel.rooms              -> likely https://api.previo.app/x1/hotel/rooms, but docs may name this Hotel.getRooms in some places
```

**Implementation plan**
1. Update shared Previo XML request helper to use the documented host `https://api.previo.app/x1` instead of `https://api.previo.cz/x1`.
2. Add the documented XML auth variant: `Authorization: ApiKey {apiKey}`.
3. In the connection test, try this documented header first and stop recommending `<login>/<password>/<apiKey>` unless it fails.
4. Update REST helper to support API-key auth as `Authorization: ApiKey {apiKey}` instead of Basic Auth when the secret is a single API key.
5. Keep backward compatibility for the earlier test hotel REST Basic Auth secret format, so the working test hotel doesn’t break.
6. After implementation, test the Ottofiori connection from the app; if it still 401s, the remaining issue is not request format — it means Previo has not activated this key for the configured `hotId`, or the `hotId` is wrong.