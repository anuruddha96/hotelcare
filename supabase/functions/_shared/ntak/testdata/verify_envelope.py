#!/usr/bin/env python3
"""Independent WS-Security check for NTAK envelopes (test helper).

Uses libxml2's exclusive C14N (via lxml) and the `cryptography` package, so it
shares no code with the TypeScript signer. Exit code 0 = valid.
Usage: verify_envelope.py envelope.xml
"""
import base64
import hashlib
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from lxml import etree

NS = {
    "ds": "http://www.w3.org/2000/09/xmldsig#",
    "wsse": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
    "wsu": "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
}
DIGESTS = {
    "http://www.w3.org/2001/04/xmlenc#sha256": hashlib.sha256,
    "http://www.w3.org/2001/04/xmldsig-more#sha384": hashlib.sha384,
    "http://www.w3.org/2001/04/xmlenc#sha512": hashlib.sha512,
}
SIGS = {
    "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256": hashes.SHA256(),
    "http://www.w3.org/2001/04/xmldsig-more#rsa-sha384": hashes.SHA384(),
    "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512": hashes.SHA512(),
}
EXC = "http://www.w3.org/2001/10/xml-exc-c14n#"


def c14n(el):
    return etree.tostring(el, method="c14n", exclusive=True, with_comments=False)


def main(path):
    doc = etree.parse(path)
    sig = doc.find(".//ds:Signature", NS)
    signed_info = sig.find("ds:SignedInfo", NS)
    if signed_info.find("ds:CanonicalizationMethod", NS).get("Algorithm") != EXC:
        raise SystemExit("unexpected canonicalization method")
    by_id = {el.get("{%s}Id" % NS["wsu"]): el for el in doc.iter() if el.get("{%s}Id" % NS["wsu"])}
    refs = signed_info.findall("ds:Reference", NS)
    if len(refs) < 1:
        raise SystemExit("no references")
    signed_tags = set()
    for ref in refs:
        target = by_id.get(ref.get("URI").lstrip("#"))
        if target is None:
            raise SystemExit("reference target missing: " + ref.get("URI"))
        signed_tags.add(etree.QName(target).localname)
        algo = DIGESTS[ref.find("ds:DigestMethod", NS).get("Algorithm")]
        value = base64.b64encode(algo(c14n(target)).digest()).decode()
        if value != ref.find("ds:DigestValue", NS).text.strip():
            raise SystemExit("digest mismatch for " + ref.get("URI"))
    if "Body" not in signed_tags:
        raise SystemExit("Body is not signed")
    token_ref = sig.find("ds:KeyInfo/wsse:SecurityTokenReference/wsse:Reference", NS).get("URI").lstrip("#")
    token = by_id[token_ref]
    cert = x509.load_der_x509_certificate(base64.b64decode("".join(token.text.split())))
    method = signed_info.find("ds:SignatureMethod", NS).get("Algorithm")
    cert.public_key().verify(
        base64.b64decode("".join(sig.find("ds:SignatureValue", NS).text.split())),
        c14n(signed_info),
        padding.PKCS1v15(),
        SIGS[method],
    )
    print("OK", sorted(signed_tags), method)


if __name__ == "__main__":
    main(sys.argv[1])
