#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import os
import pathlib
import plistlib
import secrets
import shlex
import shutil
import stat
import subprocess
import tempfile
import zipfile
from contextlib import contextmanager

ROOT = pathlib.Path(__file__).resolve().parent.parent
APPLE_ENV = ('APPLE_TEAM_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8',
             'APPLE_CERTIFICATES_P12_BASE64', 'APPLE_CERTIFICATES_PASSWORD')


def signing_environment(environment):
    if not any(environment.get(name) for name in APPLE_ENV):
        return None
    missing = [name for name in APPLE_ENV if not environment.get(name)]
    if missing:
        raise ValueError(f'Incomplete Apple signing environment; missing: {", ".join(missing)}')
    return {name: environment[name] for name in APPLE_ENV}


def run(arguments, **kwargs):
    return subprocess.run([str(argument) for argument in arguments], check=True, **kwargs)


def summary(file, files=None):
    result = {'path': str(file), 'bytes': file.stat().st_size,
              'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
    if files is not None:
        result['files'] = files
    return result


def zip_app(app, output):
    entries = {}
    for directory, directories, files in os.walk(app, followlinks=False):
        for name in directories + files:
            file = pathlib.Path(directory) / name
            mode = file.lstat().st_mode
            relative = file.relative_to(app.parent).as_posix()
            if stat.S_ISLNK(mode):
                entries[relative] = (mode, os.readlink(file).encode())
            elif stat.S_ISDIR(mode):
                entries[relative + '/'] = (mode, b'')
            elif stat.S_ISREG(mode):
                entries[relative] = (mode, file.read_bytes())
            else:
                raise ValueError(f'Unsupported app bundle entry: {relative}')
    entries[app.name + '/'] = (app.stat().st_mode, b'')
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(entries):
            mode, data = entries[name]
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = mode << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(output) as archive:
        if archive.namelist() != sorted(entries):
            raise ValueError('Safari ZIP inventory mismatch')
        for info in archive.infolist():
            mode, data = entries[info.filename]
            if archive.read(info) != data or info.external_attr >> 16 != mode:
                raise ValueError(f'Safari ZIP content/mode mismatch: {info.filename}')
    return summary(output, len(entries))


@contextmanager
def signing_credentials(directory, environment):
    key = directory / 'AuthKey.p8'
    certificates = directory / 'certificates.p12'
    key.write_bytes(base64.b64decode(environment['ASC_KEY_P8'], validate=True))
    certificates.write_bytes(base64.b64decode(environment['APPLE_CERTIFICATES_P12_BASE64'], validate=True))
    key.chmod(0o600)
    certificates.chmod(0o600)
    keychain = directory / 'signing.keychain-db'
    password = secrets.token_urlsafe(32)
    existing = shlex.split(run(['security', 'list-keychains', '-d', 'user'], capture_output=True, text=True).stdout)
    run(['security', 'create-keychain', '-p', password, keychain], capture_output=True)
    try:
        run(['security', 'set-keychain-settings', '-lut', '21600', keychain], capture_output=True)
        run(['security', 'unlock-keychain', '-p', password, keychain], capture_output=True)
        run(['security', 'import', certificates, '-k', keychain, '-P', environment['APPLE_CERTIFICATES_PASSWORD'],
             '-T', '/usr/bin/codesign', '-T', '/usr/bin/productbuild'], capture_output=True)
        run(['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain], capture_output=True)
        run(['security', 'list-keychains', '-d', 'user', '-s', keychain, *existing], capture_output=True)
        yield key
    finally:
        try:
            run(['security', 'list-keychains', '-d', 'user', '-s', *existing], capture_output=True)
        finally:
            run(['security', 'delete-keychain', keychain], capture_output=True)


def verify_app(app, version, build_number):
    if not app.is_dir():
        raise ValueError(f'Missing Safari app: {app}')
    extensions = list((app / 'Contents' / 'PlugIns').glob('*.appex'))
    if len(extensions) != 1:
        raise ValueError('Safari app must contain exactly one extension')
    for bundle in [app, *extensions]:
        with (bundle / 'Contents' / 'Info.plist').open('rb') as source:
            info = plistlib.load(source)
        if info['CFBundleShortVersionString'] != version or info['CFBundleVersion'] != build_number:
            raise ValueError(f'Safari bundle version mismatch: {bundle.name}')
    run(['codesign', '--verify', '--deep', '--strict', app])


def build(output, build_number, environment):
    version = json.loads((ROOT / 'manifest.json').read_text())['version']
    output.mkdir(parents=True, exist_ok=True)
    artifacts = []
    with tempfile.TemporaryDirectory(prefix='clockoli-safari-') as temporary:
        directory = pathlib.Path(temporary).resolve()
        extension = directory / 'extension'
        project_directory = directory / 'project'
        run(['python3', ROOT / 'scripts/build-release.py', '--target', 'safari', '--unpacked', extension])
        run(['xcrun', 'safari-web-extension-converter', extension, '--project-location', project_directory,
             '--app-name', 'Clockoli', '--bundle-identifier', 'com.clockoli.Clockoli', '--macos-only',
             '--swift', '--copy-resources', '--no-prompt', '--no-open'])
        projects = list(project_directory.rglob('*.xcodeproj'))
        if len(projects) != 1:
            raise ValueError('Converter must produce exactly one Xcode project')
        run(['node', ROOT / 'scripts/safari-icons.js', project_directory], cwd=ROOT)
        for source in project_directory.rglob('Info.plist'):
            with source.open('rb') as stream:
                info = plistlib.load(stream)
            info['CFBundleShortVersionString'] = version
            info['CFBundleVersion'] = build_number
            with source.open('wb') as stream:
                plistlib.dump(info, stream)
        listing = json.loads(run(['xcodebuild', '-list', '-json', '-project', projects[0]], capture_output=True, text=True).stdout)
        schemes = listing['project']['schemes']
        if len(schemes) != 1:
            raise ValueError('Converter must produce exactly one application scheme')
        base = ['xcodebuild', '-project', projects[0], '-scheme', schemes[0], '-configuration', 'Release',
                '-destination', 'generic/platform=macOS', f'MARKETING_VERSION={version}',
                f'CURRENT_PROJECT_VERSION={build_number}', 'ARCHS=arm64 x86_64', 'ONLY_ACTIVE_ARCH=NO']
        derived = directory / 'unsigned'
        run([*base, '-derivedDataPath', derived, 'CODE_SIGN_IDENTITY=-', 'CODE_SIGN_STYLE=Manual',
             'DEVELOPMENT_TEAM=', 'PROVISIONING_PROFILE_SPECIFIER=', 'build'])
        app = derived / 'Build/Products/Release/Clockoli.app'
        verify_app(app, version, build_number)
        artifacts.append(zip_app(app, output / f'Clockoli-{version}-safari-unsigned.zip'))
        if environment is not None:
            with signing_credentials(directory, environment) as key:
                authentication = ['-allowProvisioningUpdates', '-authenticationKeyPath', key,
                                  '-authenticationKeyID', environment['ASC_KEY_ID'],
                                  '-authenticationKeyIssuerID', environment['ASC_ISSUER_ID']]
                archive = directory / 'Clockoli.xcarchive'
                run([*base, '-derivedDataPath', directory / 'signed', '-archivePath', archive,
                     'CODE_SIGN_STYLE=Automatic', f'DEVELOPMENT_TEAM={environment["APPLE_TEAM_ID"]}',
                     'ENABLE_HARDENED_RUNTIME=YES', *authentication, 'archive'])
                for method in ['developer-id', 'app-store-connect']:
                    options = directory / f'{method}.plist'
                    with options.open('wb') as stream:
                        plistlib.dump({'method': method, 'teamID': environment['APPLE_TEAM_ID'],
                                       'signingStyle': 'automatic', 'destination': 'export',
                                       'manageAppVersionAndBuildNumber': False}, stream)
                    exported = directory / method
                    run(['xcodebuild', '-exportArchive', '-archivePath', archive, '-exportPath', exported,
                         '-exportOptionsPlist', options, *authentication])
                    if method == 'developer-id':
                        app = exported / 'Clockoli.app'
                        verify_app(app, version, build_number)
                        upload = directory / 'notarize.zip'
                        zip_app(app, upload)
                        run(['xcrun', 'notarytool', 'submit', upload, '--key', key, '--key-id', environment['ASC_KEY_ID'],
                             '--issuer', environment['ASC_ISSUER_ID'], '--wait'])
                        run(['xcrun', 'stapler', 'staple', app])
                        run(['xcrun', 'stapler', 'validate', app])
                        verify_app(app, version, build_number)
                        artifacts.append(zip_app(app, output / f'Clockoli-{version}-safari.zip'))
                    else:
                        packages = list(exported.glob('*.pkg'))
                        if len(packages) != 1:
                            raise ValueError('App Store export must produce exactly one PKG')
                        run(['pkgutil', '--check-signature', packages[0]])
                        package = output / f'Clockoli-{version}-safari.pkg'
                        shutil.copyfile(packages[0], package)
                        if package.read_bytes() != packages[0].read_bytes():
                            raise ValueError('App Store package copy mismatch')
                        artifacts.append(summary(package))
    print(json.dumps({'artifacts': artifacts}, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description='Build macOS Safari apps; sign when the complete Apple environment is present.')
    parser.add_argument('--build-number', required=True)
    parser.add_argument('output', help='Artifact directory outside the repository')
    args = parser.parse_args()
    if not args.build_number.isascii() or not args.build_number.isdigit() or int(args.build_number) < 1:
        parser.error('--build-number must be a positive integer')
    output = pathlib.Path(args.output).resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error('Build output must be outside the repository')
    try:
        environment = signing_environment(os.environ)
    except ValueError as error:
        parser.error(str(error))
    try:
        build(output, args.build_number, environment)
    except subprocess.CalledProcessError as error:
        # Subprocess arguments can contain signing credentials; never print the exception's command.
        raise SystemExit(f'External build tool failed with exit code {error.returncode}') from None


if __name__ == '__main__':
    main()
