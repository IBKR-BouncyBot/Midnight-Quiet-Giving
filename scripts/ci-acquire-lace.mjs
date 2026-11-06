// CI public artifact acquisition only. Does not load an extension or use a wallet.
// Format/verification references: Chromium components/crx_file/crx3.proto and
// components/crx_file/crx_verifier.cc. RSA uses PKCS1 SHA256 per verifier source.
import { createHash, createPublicKey, verify, constants } from 'node:crypto';
import { mkdtemp, realpath, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, isAbsolute, relative, parse } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const extensionId = 'gafhhkghbfjjkeiendhlofajokpaflmk';
const version = '2.5.1';
const expectedArchiveBytes = 73_664_073;
const expectedArchiveSha256 = 'aa6d59550362a3bbcbef343dffd783621150a7971307116bb11fe0d94b754708';
const manifestBytes = 3718;
const manifestSha256 = '5e67d8265b510e9b5b1c0546677d5f3f6316aaa440591dcc0af3d7f4a8858391';
const publisherKeyHash = '61f7f2a6bfcf74cd0bc1fe2497cc9b04254c658f79f2145392867ea8366367cf';
const initialUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=156.0.8078.4&acceptformat=crx3&x=id%3D${extensionId}%26uc`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const idFromHash = bytes => [...bytes.subarray(0, 16)].map(value => String.fromCharCode(97 + (value >> 4), 97 + (value & 15))).join('');
let stage = 'runner-directory';
const extractScript = String.raw`
import sys,zipfile,pathlib,stat,hashlib,json
archive=pathlib.Path(sys.argv[1]); output=pathlib.Path(sys.argv[2])
assert not output.exists()
with zipfile.ZipFile(archive) as z:
 infos=z.infolist(); assert len(infos)<=20000 and sum(i.file_size for i in infos)<=512*1024*1024
 manifest=z.read('manifest.json')
 assert len(manifest)==int(sys.argv[3]) and hashlib.sha256(manifest).hexdigest()==sys.argv[4]
 value=json.loads(manifest.decode('utf-8','strict')); assert value['version']==sys.argv[5] and value['manifest_version']==3
 seen=set()
 for i in infos:
  p=pathlib.PurePosixPath(i.filename)
  assert i.filename and '\\' not in i.filename and not p.is_absolute() and all(t not in ('..','.') for t in p.parts)
  assert ':' not in i.filename and not (i.flag_bits&1) and i.compress_type in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED)
  assert stat.S_IFMT(i.external_attr>>16)!=stat.S_IFLNK and i.file_size<=128*1024*1024
  key=str(p).casefold(); assert key not in seen; seen.add(key)
  assert (output/pathlib.Path(*p.parts)).resolve().is_relative_to(output)
 output.mkdir(mode=0o700)
 for i in infos:
  p=output/pathlib.Path(*pathlib.PurePosixPath(i.filename).parts)
  if i.is_dir(): p.mkdir(parents=True,exist_ok=True)
  else:
   p.parent.mkdir(parents=True,exist_ok=True)
   with z.open(i) as source,p.open('xb') as destination:
    while chunk:=source.read(1024*1024): destination.write(chunk)
 print(json.dumps({'files':len(infos),'uncompressedBytes':sum(i.file_size for i in infos)}))
`;

function fields(bytes) {
  let position = 0;
  const varint = () => {
    let result = 0, shift = 0;
    for (;;) {
      if (position >= bytes.length || shift > 49) throw new Error('Invalid protobuf integer');
      const byte = bytes[position++]; result += (byte & 127) * 2 ** shift;
      if (!Number.isSafeInteger(result)) throw new Error('Oversized protobuf integer');
      if (!(byte & 128)) return result;
      shift += 7;
    }
  };
  const result = [];
  while (position < bytes.length) {
    const tag = varint(), field = Math.floor(tag / 8), wire = tag % 8;
    if (!field) throw new Error('Invalid protobuf field');
    if (wire === 0) { varint(); continue; }
    const length = wire === 2 ? varint() : wire === 1 ? 8 : wire === 5 ? 4 : -1;
    if (length < 0 || length > bytes.length - position) throw new Error('Invalid protobuf length');
    result.push({ field, wire, bytes: bytes.subarray(position, position + length) }); position += length;
  }
  return result;
}
function one(values, field) {
  const matches = values.filter(value => value.field === field && value.wire === 2);
  if (matches.length !== 1) throw new Error('Missing or duplicated protobuf field');
  return matches[0].bytes;
}

try {
  if (process.argv.length !== 2 || !process.env.RUNNER_TEMP || !isAbsolute(process.env.RUNNER_TEMP)
      || /[\r\n]/.test(process.env.RUNNER_TEMP)) throw new Error('Explicit runner temporary directory required');
  const runnerRoot = await realpath(process.env.RUNNER_TEMP);
  if (runnerRoot === parse(runnerRoot).root) throw new Error('Filesystem root is not a runner directory');
  const directory = await mkdtemp(join(runnerRoot, 'midnight-lace-'));
  const child = relative(runnerRoot, directory);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Invalid extraction directory');
  stage = 'download';
  const origins = [], allowedHosts = new Set(['clients2.google.com', 'clients2.googleusercontent.com']);
  let url = new URL(initialUrl), response;
  for (let redirects = 0; redirects < 5; redirects++) {
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password) throw new Error('Unapproved artifact source');
    origins.push(url.origin);
    response = await fetch(url, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(120_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('Redirect location missing');
      url = new URL(location, url); continue;
    }
    break;
  }
  if (!response?.ok || !response.body) throw new Error('Artifact response failed');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length; if (size > 128 * 1024 * 1024) throw new Error('Artifact exceeds size limit');
    chunks.push(chunk);
  }
  const crx = Buffer.concat(chunks);
  stage = 'verify-crx3';
  if (crx.length < 12 || crx.toString('ascii', 0, 4) !== 'Cr24' || crx.readUInt32LE(4) !== 3) throw new Error('Expected CRX3');
  const headerSize = crx.readUInt32LE(8);
  if (headerSize > 16 * 1024 * 1024 || headerSize > crx.length - 12) throw new Error('Invalid CRX header size');
  const headerBytes = crx.subarray(12, 12 + headerSize), header = fields(headerBytes);
  for (const marker of [Buffer.from([80,75,5,6]), Buffer.from([80,75,6,7]), Buffer.from([80,75,6,6])]) {
    if (headerBytes.includes(marker)) throw new Error('ZIP terminator inside CRX header');
  }
  const signedHeader = one(header, 10000), declaredId = one(fields(signedHeader), 1);
  if (declaredId.length !== 16 || idFromHash(declaredId) !== extensionId) throw new Error('Unexpected signed extension ID');
  const archive = crx.subarray(12 + headerSize), length = Buffer.alloc(4); length.writeUInt32LE(signedHeader.length);
  const signedBytes = Buffer.concat([Buffer.from('CRX3 SignedData\0'), length, signedHeader, archive]);
  const proofs = header.filter(value => value.wire === 2 && [2, 3].includes(value.field));
  let developer = false, publisher = false; const verifiedProofs = [];
  for (const proof of proofs) {
    const values = fields(proof.bytes), publicKey = one(values, 1), signature = one(values, 2);
    const key = createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== (proof.field === 2 ? 'rsa' : 'ec')) throw new Error('CRX proof key type mismatch');
    const options = proof.field === 2 ? { key, padding: constants.RSA_PKCS1_PADDING } : key;
    if (!verify('sha256', signedBytes, options, signature)) throw new Error('CRX signature verification failed');
    const keyHash = sha256(publicKey), isDeveloper = idFromHash(Buffer.from(keyHash, 'hex')) === extensionId;
    developer ||= isDeveloper; publisher ||= keyHash === publisherKeyHash;
    verifiedProofs.push({ algorithm: proof.field === 2 ? 'RSA-PKCS1-SHA256' : 'ECDSA-SHA256', publicKeySha256: keyHash,
      developerIdMatches: isDeveloper, chromiumWebStorePublisherKey: keyHash === publisherKeyHash, signatureVerified: true });
  }
  if (!developer || !publisher) throw new Error('Required developer or Web Store publisher proof missing');
  if (archive.readUInt32LE(0) !== 0x04034b50) throw new Error('CRX archive has no ZIP local header');
  stage = 'verify-pinned-version';
  if (archive.length !== expectedArchiveBytes || sha256(archive) !== expectedArchiveSha256) throw new Error('Reviewed archive changed');
  stage = 'write-public-artifact';
  await writeFile(join(directory, 'lace-official.crx'), crx);
  await writeFile(join(directory, 'lace-official.zip'), archive);
  stage = 'extract-verified-package';
  const extension = join(directory, 'extension');
  const extraction = await promisify(execFile)(process.platform === 'win32' ? 'python' : 'python3',
    ['-c', extractScript, join(directory, 'lace-official.zip'), extension, String(manifestBytes), manifestSha256, version],
    { windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024 });
  const extracted = JSON.parse(extraction.stdout);
  if (extracted.files !== 1086 || extracted.uncompressedBytes !== 178245221) throw new Error('Unexpected extraction metadata');
  const manifestRaw = await readFile(join(extension, 'manifest.json'));
  if (manifestRaw.length !== manifestBytes || sha256(manifestRaw) !== manifestSha256) throw new Error('Extracted manifest mismatch');
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  if (manifest.version !== version || typeof manifest.key !== 'string'
      || idFromHash(Buffer.from(sha256(Buffer.from(manifest.key, 'base64')), 'hex')) !== extensionId) throw new Error('Extension identity mismatch');
  const report = { acquiredAt: new Date().toISOString(), extensionId,
    schema: 'private-donations/official-lace-acquisition/v1', version,
    storeUrl: `https://chromewebstore.google.com/detail/lace/${extensionId}`,
    transport: { verifiedTls: true, sourceOrigins: origins }, crxVersion: 3,
    crxBytes: crx.length, crxSha256: sha256(crx), archiveBytes: archive.length, archiveSha256: sha256(archive),
    manifestBytes, manifestSha256, extractedFiles: extracted.files, uncompressedBytes: extracted.uncompressedBytes,
    developerSignatureVerified: developer, webStorePublisherSignatureVerified: publisher, proofs: verifiedProofs,
    extensionLoaded: false, walletCreated: false, walletConnected: false, transactionSubmitted: false,
    verifierSources: ['https://raw.githubusercontent.com/chromium/chromium/main/components/crx_file/crx3.proto',
      'https://raw.githubusercontent.com/chromium/chromium/main/components/crx_file/crx_verifier.cc'] };
  const reportPath = join(directory, 'lace-acquisition.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `extension-path=${extension}\nacquisition-report=${reportPath}\nextension-version=${version}\n`);
  }
  process.stdout.write(JSON.stringify(report) + '\n');
} catch {
  process.stderr.write(JSON.stringify({ status: 'failed', stage, privateDataCollected: false }) + '\n');
  process.exitCode = 1;
}
