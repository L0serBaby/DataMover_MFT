DataMover — TLS certificate directory
======================================

Drop TLS material here and DataMover will start in HTTPS mode automatically.
If no certificate is found at startup it falls back to HTTP with a log warning.

Two formats are supported — PFX takes priority if both are configured:


Option A — PFX / PKCS#12 (preferred on Windows)
-------------------------------------------------
Useful when the certificate comes from Windows Certificate Manager or an
internal CA that exports .pfx files directly. No openssl conversion needed.

Place the file here and add to data/config.json:
  "SSL_PFX":      "certs/server.pfx"
  "SSL_PFX_PASS": "your-pfx-passphrase"   <-- omit if the PFX has no password

Export from Windows Certificate Manager (certlm.msc):
  Right-click certificate → All Tasks → Export → Yes, export the private key
  → PKCS #12 (.pfx) → set a password → save to certs\server.pfx

Export via PowerShell (if cert is already in the store):
  $cert = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -like "*datamover*" }
  $pwd  = ConvertTo-SecureString "your-passphrase" -AsPlainText -Force
  Export-PfxCertificate -Cert $cert -FilePath certs\server.pfx -Password $pwd


Option B — PEM cert + key (OpenSSL / Linux CA / Let's Encrypt)
--------------------------------------------------------------
Add to data/config.json (or omit to use the defaults below):
  "SSL_CERT": "certs/server.crt"
  "SSL_KEY":  "certs/server.key"

Generate a self-signed cert with OpenSSL (Git for Windows / WSL):
  openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes ^
    -keyout certs\server.key -out certs\server.crt ^
    -subj "/CN=datamover.local" ^
    -addext "subjectAltName=DNS:datamover.local,DNS:localhost,IP:127.0.0.1"

For production use a certificate from your internal Windows CA (certreq) or
a public CA fronted by an IIS / nginx reverse proxy for TLS termination.


Paths
-----
All paths in config.json can be absolute or relative to the project root.


Security note
-------------
Keep private keys and PFX files out of source control.
The .gitignore in this directory excludes *.crt, *.key, *.pem, *.pfx, *.p12.
