'use strict';

const os = require('os');
const debug = require('debug')('wicked-sdk');
const request = require('request');
const qs = require('querystring');
const uuid = require('node-uuid');

import { WickedError } from "./wicked-error";

const WICKED_TIMEOUT = 2000; // request timeout for wicked API operations
const KONG_TIMEOUT = 5000; // request timeout for kong admin API operations
const TRYGET_TIMEOUT = 2000; // request timeout for single calls in awaitUrl

// ====== VARIABLES ======

// Use this for local caching of things. Usually just the globals.
// The apiUrl will - after initialization - contain the URL which
// was used to access the portal API with.
const wickedStorage = {
    initialized: false,
    kongAdapterInitialized: false,
    kongOAuth2Initialized: false,
    machineUserId: null,
    apiUrl: null,
    globals: null,
    correlationId: null,
    configHash: null,
    userAgent: null,
    pendingExit: false,
    apiReachable: false,
    // This field will not necessarily be filled.
    apiVersion: null,
    isV012OrHigher: false,
    isV100OrHigher: false,
    portalApiScope: null
};

// ======= SDK INTERFACE =======

// ====================
// INTERNAL TYPES
// ====================

interface RequestBody {
    method: string,
    url: string,
    timeout?: number,
    json?: boolean,
    body?: any
}

// ====================
// WICKED TYPES
// ====================

export interface WickedAwaitOptions {
    statusCode?: number,
    maxTries?: number,
    retryDelay?: number
}

export interface WickedInitOptions extends WickedAwaitOptions {
    userAgentName: string,
    userAgentVersion: string,
    doNotPollConfigHash?: boolean
}

export interface WickedGlobals {
    version: number,
    title: string,
    footer: string,
    company: string,
    // Group validated users are automatically assigned to
    validatedUsergGroup?: string,
    // Used to validate that the secret config key is correct
    configKeyCheck: string,
    api?: WickedGlobalsApi
    network: WickedGlobalsNetwork,
    db: WickedGlobalsDb,

    sessionStore: WickedSessionStoreConfig,
    kongAdapter?: WickedKongAdapterConfig,
    portal: WickedPortalConfig,
    storage: WickedStorageConfig,

    initialUsers: WickedGlobalsInitialUser[],
    recaptcha: WickedRecaptchaConfig
    mailer: WickedMailerConfig
    chatbot: WickedChatbotConfig,
    layouts?: WickedLayoutConfig
    views?: WickedViewsConfig
}

export interface WickedStorageConfig {
    type: WickedStorageType
    pgHost?: string
    pgPort?: number,
    pgUser?: string,
    pgPassword?: string
}

export enum WickedStorageType {
    JSON = 'json',
    Postgres = 'postgres'
}

export interface WickedPortalConfig {
    // Array of allowed auth methods for the portal login; in the form
    // <auth server name>:<auth method name>,
    // Example: ["default:local", "default:google"]
    authMethods: string[]
}

export interface WickedKongAdapterConfig {
    useKongAdapter: boolean,
    // List of Kong plugins which the Kong Adapter doesn't touch when configuring Kong
    ignoreList: string[]
}

export interface WickedSessionStoreConfig {
    type: WickedSessionStoreType
    host?: string,
    port?: number,
    password?: string
}

export enum WickedSessionStoreType {
    Redis = 'redis',
    File = 'file'
}

export interface WickedViewsConfig {
    apis: {
        showApiIcon: boolean,
        titleTagline: string
    },
    applications: {
        titleTagline: string
    },
    application: {
        titleTagline: string
    }
}

export interface WickedLayoutConfig {
    defautRootUrl: string,
    defautRootUrlTarget: string,
    defautRootUrlText: null,
    menu: {
      homeLinkText: string,
      apisLinkVisibleToGuest: boolean,
      applicationsLinkVisibleToGuest: boolean,
      contactLinkVisibleToGuest: boolean,
      contentLinkVisibleToGuest: boolean,
      classForLoginSignupPosition: string,
      showSignupLink: boolean,
      loginLinkText: string
    },
    footer: {
      showBuiltBy: boolean,
      showBuilds: boolean
    },
    swaggerUi: {
      menu: {
        homeLinkText: string,
        showContactLink: boolean,
        showContentLink: boolean
      }
    }
}

export interface WickedChatbotConfig {
    username: string,
    icon_url: string,
    hookUrls: string[],
    events: WickedChatbotEventsConfig
}

export interface WickedChatbotEventsConfig {
    userSignedUp: boolean,
    userValidatedEmail: boolean,
    applicationAdded: boolean,
    applicationDeleted: boolean,
    subscriptionAdded: boolean,
    subscriptionDeleted: boolean,
    approvalRequired: boolean,
    lostPasswordRequest: boolean,
    verifyEmailRequest: boolean
}

export interface WickedMailerConfig {
    senderEmail: string,
    senderName: string,
    smtpHost: string,
    smtpPort?: number,
    username?: string,
    password?: string,
    adminEmail: string,
    adminName: string
}

export interface WickedRecaptchaConfig {
    useRecaptcha: boolean,
    websiteKey: string,
    secretKey: string
}

export interface WickedGlobalsApi {
    headerName: string
}

export interface WickedGlobalsNetwork {
    schema: string,
    portalHost: string,
    apiHost: string,
    apiUrl: string,
    portalUrl: string,
    kongAdapterUrl: string,
    kongAdminUrl: string,
    mailerUrl: string,
    chatbotUrl: string
}

export interface WickedGlobalsDb {
    staticConfig: string,
    dynamicConfig?: string
}

export interface WickedGlobalsInitialUser {
    id: string,
    customId?: string,
    name: string
    email: string,
    password?: string,
    validated?: boolean,
    groups: string[]
}

export interface WickedUserInfo {
    id: string,
    customId?: string,
    email?: string,
    password?: string,
    validated?: boolean,
    groups: string[]
}

export interface WickedUserCreateInfo {
    customId?: string,
    email: string,
    password?: string,
    validated: boolean,
    groups: string[]
}

export interface WickedApi {
    id: string,
    name: string,
    desc: string,
    auth: string,
    authServers?: string[],
    authMethods?: string[],
    registrationPool?: string,
    requiredGroup?: string,
    settings: WickedApiSettings
}

export interface WickedApiSettings {
    enable_client_credentials?: boolean,
    enable_implicit_grant?: boolean,
    enable_authorization_code?: boolean,
    enable_password_grant?: boolean,
    token_expiration?: string,
    scopes: WickedApiScopes,
    tags: string[],
    plans: string[],
    internal?: boolean
}

export interface WickedApiScopes {
    [scope: string]: {
        description: string
    }
}

export interface WickedScopeGrant {
    scope: string,
    grantedDate?: string // DateTime
}

export interface WickedGrantCollection {
    items: WickedGrant[]
}

export interface WickedGrant {
    userId?: string,
    apiId?: string,
    applicationId?: string,
    grants: WickedScopeGrant[]
}

export interface WickedAuthMethod {
    enabled: string,
    name: string,
    type: string,
    friendlyShort: string,
    friendlyLong: string,
    config: any
}

export interface WickedAuthServer {
    id: string,
    name: string,
    authMethods: WickedAuthMethod[],
    config: {
        api: KongApi,
        plugins: KongPlugin[]
    }
}

export enum WickedOwnerRole {
    Owner = "owner",
    Collaborator = "collaborator",
    Reader = "reader"
}

export interface WickedOwner {
    userId: string,
    email: string,
    role: WickedOwnerRole
}

export interface WickedApplication {
    id: string,
    name: string,
    redirectUri: string,
    confidential: boolean,
    ownerList: WickedOwner[]
}

export enum WickedAuthType {
    KeyAuth = "key-auth",
    OAuth2 = "oauth2"
}

export interface WickedSubscription {
    application: string,
    api: string,
    plan: string,
    auth: WickedAuthType,
    apikey?: string,
    clientId?: string,
    clientSecret?: string,
    approved: boolean,
    trusted?: boolean
}

export interface WickedSubscriptionInfo {
    application: WickedApplication,
    subscription: WickedSubscription
}

export enum WickedPoolPropertyType {
    String = "string"
}

export interface WickedPoolProperty {
    id: string,
    description: string,
    type: string,
    maxLength: number,
    minLength: number,
    required: boolean,
    oidcClaim: string
}

export interface WickedPool {
    id: string,
    name: string,
    requiresNamespace: boolean,
    // Disallow interactive registration
    disallowRegister: boolean,
    properties: WickedPoolProperty[]
}

export interface WickedRegistration {
    userId: string,
    poolId: string,
    namespace?: string
}

export interface WickedRegistrationCollection {
    items: WickedRegistration[],
    count: number,
    count_cached: boolean
}

export interface WickedNamespace {
    namespace: string,
    poolId: string,
    description: string
}

// ====================
// KONG TYPES
// ====================

export interface KongApi {
    retries: number,
    upstream_send_timeout: number,
    upstream_connect_timeout: number,
    id: string,
    upstream_read_timeout: number,
    strip_uri: boolean,
    created_at: number,
    upstream_url: string,
    name: string,
    uris: string[],
    preserve_host: boolean,
    http_if_terminated: boolean,
    https_only: boolean
}

export interface KongPlugin {
    name: string,
    config: any
}

// ====================
// CALLBACK TYPES
// ====================

export interface ErrorCallback {
    (err?): void
}

export interface WickedGlobalsCallback {
    (err?, globals?: WickedGlobals): void
}

export interface WickedUserInfoCallback {
    (err?, userInfo?: WickedUserInfo): void
}

export interface WickedObjectCallback {
    (err?, o?: any): void
}

export interface WickedApiCallback {
    (err, wickedApi?: WickedApi): void
}

export interface WickedPoolCallback {
    (err, poolInfo?: WickedPool): void
}

export interface KongApiCallback {
    (err, kongApi?: KongApi): void
}

// ====================
// FUNCTION TYPES
// ====================

export interface ExpressHandler {
    (req, res, next?): void
}

// ======= INITIALIZATION =======

export function initialize(options: WickedInitOptions, callback: WickedGlobalsCallback): void {
    _initialize(options, callback);
}

export function isDevelopmentMode(): boolean {
    return _isDevelopmentMode();
};

export function initMachineUser(serviceId: string, callback: ErrorCallback): void {
    _initMachineUser(serviceId, callback);
};

export function awaitUrl(url: string, options: WickedAwaitOptions, callback: WickedObjectCallback): void {
    _awaitUrl(url, options, callback);
};

export function awaitKongAdapter(awaitOptions: WickedAwaitOptions, callback: WickedObjectCallback): void {
    _awaitKongAdapter(awaitOptions, callback);
};

// exports.awaitKongOAuth2 = function (awaitOptions, callback) {
//     awaitKongOAuth2(awaitOptions, callback);
// };

// ======= INFORMATION RETRIEVAL =======

export function getGlobals(): WickedGlobals {
    return _getGlobals();
};

export function getConfigHash(): string {
    return _getConfigHash();
};

export function getSchema(): string {
    return _getSchema();
};

export function getExternalPortalHost(): string {
    return _getExternalPortalHost();
};

export function getExternalPortalUrl(): string {
    return _getExternalPortalUrl();
};

export function getExternalApiHost(): string {
    return _getExternalGatewayHost();
};

export function getExternalApiUrl(): string {
    return _getExternalGatewayUrl();
};

export function getInternalApiUrl(): string {
    return _getInternalApiUrl();
};

export function getPortalApiScope(): string {
    return _getPortalApiScope();
};

export function getInternalKongAdminUrl(): string {
    return _getInternalKongAdminUrl();
};

export function getInternalKongAdapterUrl(): string {
    return _getInternalKongAdapterUrl();
};

export function getInternalKongOAuth2Url(): string {
    return _getInternalKongOAuth2Url();
};

export function getInternalChatbotUrl(): string {
    return _getInternalChatbotUrl();
};

export function getInternalMailerUrl(): string {
    return _getInternalMailerUrl();
};

export function getInternalUrl(globalSettingsProperty: string): string {
    return _getInternalUrl(globalSettingsProperty, null, 0);
};

// ======= API FUNCTIONALITY =======

export function apiGet(urlPath: string, userIdOrCallback, callback): void {
    let userId = userIdOrCallback;
    if (!callback && typeof (userIdOrCallback) === 'function') {
        callback = userIdOrCallback;
        userId = null;
    }
    _apiGet(urlPath, userId, null, callback);
};

export function apiPost(urlPath: string, postBody: object, userIdOrCallback, callback): void {
    let userId = userIdOrCallback;
    if (!callback && typeof (userIdOrCallback) === 'function') {
        callback = userIdOrCallback;
        userId = null;
    }
    _apiPost(urlPath, postBody, userId, callback);
};

export function apiPut(urlPath: string, putBody: object, userIdOrCallback, callback): void {
    let userId = userIdOrCallback;
    if (!callback && typeof (userIdOrCallback) === 'function') {
        callback = userIdOrCallback;
        userId = null;
    }
    _apiPut(urlPath, putBody, userId, callback);
};

export function apiPatch(urlPath: string, patchBody: object, userIdOrCallback, callback): void {
    let userId = userIdOrCallback;
    if (!callback && typeof (userIdOrCallback) === 'function') {
        callback = userIdOrCallback;
        userId = null;
    }
    _apiPatch(urlPath, patchBody, userId, callback);
};

export function apiDelete(urlPath: string, userIdOrCallback, callback): void {
    let userId = userIdOrCallback;
    if (!callback && typeof (userIdOrCallback) === 'function') {
        callback = userIdOrCallback;
        userId = null;
    }
    _apiDelete(urlPath, userId, callback);
};

// ======= OAUTH2 CONVENIENCE FUNCTIONS ======= 

export function getRedirectUriWithAccessToken(userInfo, callback) {
    _getRedirectUriWithAccessToken(userInfo, callback);
};

export function oauth2AuthorizeImplicit(userInfo, callback) {
    _oauth2AuthorizeImplicit(userInfo, callback);
};

export function oauth2GetAuthorizationCode(userInfo, callback) {
    _oauth2GetAuthorizationCode(userInfo, callback);
};

export function oauth2GetAccessTokenPasswordGrant(userInfo, callback) {
    _oauth2GetAccessTokenPasswordGrant(userInfo, callback);
};

export function oauth2RefreshAccessToken(tokenInfo, callback) {
    _oauth2RefreshAccessToken(tokenInfo, callback);
};

export function oauth2GetAccessTokenInfo(accessToken, callback) {
    _oauth2GetAccessTokenInfo(accessToken, callback);
};

export function oauth2GetRefreshTokenInfo(refreshToken, callback) {
    _oauth2GetRefreshTokenInfo(refreshToken, callback);
};

export function getSubscriptionByClientId(clientId, apiId, callback) {
    _getSubscriptionByClientId(clientId, apiId, callback);
};

export function revokeAccessToken(accessToken, callback) {
    _revokeAccessToken(accessToken, callback);
};

export function revokeAccessTokensByUserId(authenticatedUserId, callback) {
    _revokeAccessTokensByUserId(authenticatedUserId, callback);
};

// v1.0.0+ Methods, cannot be used with wicked <1.0.0, pre-release.
export const oauth2 = {
    authorize: function (authRequest, callback) {
        _v1_oauth2Authorize(authRequest, callback);
    },
    token: function (tokenRequest, callback) {
        _v1_oauth2Token(tokenRequest, callback);
    },
    getAccessTokenInfo: function (accessToken, callback) {
        _v1_oauth2GetAccessTokenInfo(accessToken, callback);
    },
    getRefreshTokenInfo: function (refreshToken, callback) {
        _v1_oauth2GetRefreshTokenInfo(refreshToken, callback);
    },
    revokeAccessToken: function (accessToken, callback) {
        _v1_revokeAccessToken(accessToken, callback);
    },
    revokeAccessTokensByUserId: function (authenticatedUserId, callback) {
        _v1_revokeAccessTokensByUserId(authenticatedUserId, callback);
    }
};

// module.exports.oauth2 = oauth2;

// ======= CORRELATION ID HANDLER =======

export function correlationIdHandler(): ExpressHandler {
    return function (req, res, next) {
        const correlationId = req.get('correlation-id');
        if (correlationId) {
            debug('Picking up correlation id: ' + correlationId);
            req.correlationId = correlationId;
        } else {
            req.correlationId = uuid.v4();
            debug('Creating a new correlation id: ' + req.correlationId);
        }
        wickedStorage.correlationId = correlationId;
        return next();
    };
}

// ======= IMPLEMENTATION ======

function _initialize(options: WickedInitOptions, callback: WickedGlobalsCallback): void {
    debug('initialize()');
    if (!callback && (typeof (options) === 'function')) {
        callback = options;
        options = null;
    }
    if (options) {
        debug('options:');
        debug(options);
    }

    const validationError = validateOptions(options);
    if (validationError) {
        return callback(validationError);
    }

    // I know, this would look a lot nicer with async or Promises,
    // but I did not want to pull in additional dependencies.
    const apiUrl = resolveApiUrl();
    debug('Awaiting portal API at ' + apiUrl);
    _awaitUrl(apiUrl + 'ping', options, function (err, pingResult) {
        if (err) {
            debug('awaitUrl returned an error:');
            debug(err);
            return callback(err);
        }

        debug('Ping result:');
        debug(pingResult);
        const pingJson = getJson(pingResult);
        if (pingJson.version) {
            // The version field is not filled until wicked 0.12.0
            wickedStorage.apiVersion = pingJson.version;
            wickedStorage.isV012OrHigher = true;
            if (pingJson.version >= '1.0.0') {
                wickedStorage.isV100OrHigher = true;
            }
        }

        wickedStorage.apiUrl = apiUrl;
        if (options.userAgentName && options.userAgentVersion)
            wickedStorage.userAgent = options.userAgentName + '/' + options.userAgentVersion;
        request.get({
            url: apiUrl + 'confighash',
            timeout: WICKED_TIMEOUT
        }, function (err, res, body) {
            if (err) {
                debug('GET /confighash failed');
                debug(err);
                return callback(err);
            }

            if (200 != res.statusCode) {
                debug('GET /confighash returned status code: ' + res.statusCode);
                debug('Body: ' + body);
                return callback(new Error('GET /confighash returned unexpected status code: ' + res.statusCode + ' (Body: ' + body + ')'));
            }

            wickedStorage.configHash = '' + body;

            request.get({
                url: apiUrl + 'globals',
                headers: {
                    'User-Agent': wickedStorage.userAgent,
                    'X-Config-Hash': wickedStorage.configHash
                },
                timeout: WICKED_TIMEOUT
            }, function (err, res, body) {
                if (err) {
                    debug('GET /globals failed');
                    debug(err);
                    return callback(err);
                }
                if (res.statusCode !== 200) {
                    debug('GET /globals returned status code ' + res.statusCode);
                    return callback(new Error('GET /globals return unexpected error code: ' + res.statusCode));
                }

                let globals = null;
                try {
                    globals = getJson(body);
                    wickedStorage.globals = globals;
                    wickedStorage.initialized = true;
                    wickedStorage.apiReachable = true;
                } catch (ex) {
                    return callback(new Error('Parsing globals failed: ' + ex.message));
                }

                // Success, set up config hash checker loop (if not switched off)
                if (!options.doNotPollConfigHash) {
                    setInterval(checkConfigHash, 10000);
                }

                return callback(null, globals);
            });
        });
    });
}

function validateOptions(options) {
    if ((options.userAgentName && !options.userAgentVersion) ||
        (!options.userAgentName && options.userAgentVersion))
        return new Error('You need to specify both userAgentName and userAgentVersion');
    if (options.userAgentName &&
        !/^[a-zA-Z\ \-\_\.0-9]+$/.test(options.userAgentName))
        return new Error('The userAgentName must only contain characters a-z, A-Z, 0-9, -, _ and space.');
    if (options.userAgentVersion &&
        !/^[0-9\.]+$/.test(options.userAgentVersion))
        return new Error('The userAgentVersion must only contain characters 0-9 and .');
    return null;
}

function checkConfigHash() {
    debug('checkConfigHash()');

    request.get({
        url: wickedStorage.apiUrl + 'confighash',
        timeout: WICKED_TIMEOUT
    }, function (err, res, body) {
        wickedStorage.apiReachable = false;
        if (err) {
            console.error('checkConfigHash(): An error occurred.');
            console.error(err);
            console.error(err.stack);
            return;
        }
        if (200 !== res.statusCode) {
            console.error('checkConfigHash(): Returned unexpected status code: ' + res.statusCode);
            return;
        }
        wickedStorage.apiReachable = true;
        const configHash = '' + body;

        if (configHash !== wickedStorage.configHash) {
            console.log('checkConfigHash() - Detected new configuration version, scheduling shutdown in 2 seconds.');
            wickedStorage.pendingExit = true;
            setTimeout(forceExit, 2000);
        }
    });
}

function forceExit() {
    console.log('Exiting component due to outdated configuration (confighash mismatch).');
    process.exit(0);
}

function _isDevelopmentMode() {
    checkInitialized('isDevelopmentMode');

    if (wickedStorage.globals &&
        wickedStorage.globals.network &&
        wickedStorage.globals.network.schema &&
        wickedStorage.globals.network.schema === 'https')
        return false;
    return true;
}

const DEFAULT_AWAIT_OPTIONS = {
    statusCode: 200,
    maxTries: 100,
    retryDelay: 1000
};

function _awaitUrl(url: string, options: WickedAwaitOptions, callback: WickedObjectCallback) {
    debug('awaitUrl(): ' + url);
    if (!callback && (typeof (options) === 'function')) {
        callback = options;
        options = null;
    }
    // Copy the settings from the defaults; otherwise we'd change them haphazardly
    const awaitOptions: WickedAwaitOptions = {
        statusCode: DEFAULT_AWAIT_OPTIONS.statusCode,
        maxTries: DEFAULT_AWAIT_OPTIONS.maxTries,
        retryDelay: DEFAULT_AWAIT_OPTIONS.retryDelay
    };
    if (options) {
        if (options.statusCode)
            awaitOptions.statusCode = options.statusCode;
        if (options.maxTries)
            awaitOptions.maxTries = options.maxTries;
        if (options.retryDelay)
            awaitOptions.retryDelay = options.retryDelay;
    }

    debug('Invoking tryGet()');
    tryGet(url, awaitOptions.statusCode, awaitOptions.maxTries, 0, awaitOptions.retryDelay, function (err, body) {
        debug('tryGet() returned.');
        if (err) {
            debug('but tryGet() errored.');
            debug(err);
            return callback(err);
        }
        callback(null, body);
    });
}

function _awaitKongAdapter(awaitOptions, callback) {
    debug('awaitKongAdapter()');
    checkInitialized('awaitKongAdapter');
    if (!callback && (typeof (awaitOptions) === 'function')) {
        callback = awaitOptions;
        awaitOptions = null;
    }
    if (awaitOptions) {
        debug('awaitOptions:');
        debug(awaitOptions);
    }

    const adapterPingUrl = _getInternalKongAdapterUrl() + 'ping';
    _awaitUrl(adapterPingUrl, awaitOptions, function (err, body) {
        if (err)
            return callback(err);
        wickedStorage.kongAdapterInitialized = true;
        return callback(null, body);
    });
}

function awaitKongOAuth2(awaitOptions, callback) {
    debug('awaitKongOAuth2()');
    checkInitialized('awaitKongOAuth2');
    if (!callback && (typeof (awaitOptions) === 'function')) {
        callback = awaitOptions;
        awaitOptions = null;
    }
    if (awaitOptions) {
        debug('awaitOptions:');
        debug(awaitOptions);
    }

    const oauth2PingUrl = _getInternalKongOAuth2Url() + 'ping';
    _awaitUrl(oauth2PingUrl, awaitOptions, function (err, body) {
        if (err)
            return callback(err);
        wickedStorage.kongOAuth2Initialized = true;
        return callback(null, body);
    });
}

function _initMachineUser(serviceId: string, callback: ErrorCallback) {
    debug('initMachineUser()');
    checkInitialized('initMachineUser');
    retrieveOrCreateMachineUser(serviceId, (err, _) => {
        if (err)
            return callback(err);
        // wickedStorage.machineUserId has been filled now;
        // now we want to retrieve the API scopes of portal-api.
        return initPortalApiScopes(callback);
    });
}

function retrieveOrCreateMachineUser(serviceId: string, callback: WickedUserInfoCallback) {
    debug('retrieveOrCreateMachineUser()');
    if (!/^[a-zA-Z\-_0-9]+$/.test(serviceId))
        return callback(new Error('Invalid Service ID, must only contain a-z, A-Z, 0-9, - and _.'));

    const customId = makeMachineUserCustomId(serviceId);
    _apiGet('users?customId=' + qs.escape(customId), null, 'read_users', function (err, userInfo) {
        if (err && err.statusCode == 404) {
            // Not found
            return createMachineUser(serviceId, callback);
        } else if (err) {
            return callback(err);
        }
        if (!Array.isArray(userInfo))
            return callback(new Error('GET of user with customId ' + customId + ' did not return expected array.'));
        if (userInfo.length !== 1)
            return callback(new Error('GET of user with customId ' + customId + ' did not return array of length 1 (length == ' + userInfo.length + ').'));
        userInfo = userInfo[0]; // Pick the user from the list.
        storeMachineUser(userInfo);
        return callback(null, userInfo);
    });
}

function storeMachineUser(userInfo) {
    debug('Machine user info:');
    debug(userInfo);
    debug('Setting machine user id: ' + userInfo.id);
    wickedStorage.machineUserId = userInfo.id;
}

function makeMachineUserCustomId(serviceId) {
    const customId = 'internal:' + serviceId;
    return customId;
}

function createMachineUser(serviceId, callback) {
    const customId = makeMachineUserCustomId(serviceId);
    const userInfo = {
        customId: customId,
        firstName: 'Machine-User',
        lastName: serviceId,
        email: serviceId + '@wicked.haufe.io',
        validated: true,
        groups: ['admin']
    };
    _apiPost('users/machine', userInfo, null, function (err, userInfo) {
        if (err)
            return callback(err);
        storeMachineUser(userInfo);
        return callback(null, userInfo);
    });
}

function initPortalApiScopes(callback) {
    debug('initPortalApiScopes()');
    if (!wickedStorage.machineUserId)
        return callback(new Error('initPortalApiScopes: Machine user id not initialized.'));
    _apiGet('apis/portal-api', null, 'read_apis', (err, apiInfo) => {
        if (err)
            return callback(err);
        debug(apiInfo);
        if (!apiInfo.settings)
            return callback(new Error('initPortalApiScope: Property settings not found.'));
        if (!apiInfo.settings.scopes)
            return callback(new Error('initPortalApiScope: Property settings.scopes not found.'));
        const scopeList = [];
        for (let scope in apiInfo.settings.scopes) {
            scopeList.push(scope);
        }
        wickedStorage.portalApiScope = scopeList.join(' ');
        debug(`initPortalApiScopes: Full API Scope: "${wickedStorage.portalApiScope}"`);
        return callback(null);
    });
}

function _getGlobals() {
    debug('getGlobals()');
    checkInitialized('getGlobals');

    return wickedStorage.globals;
}

function _getConfigHash() {
    debug('getConfigHash()');
    checkInitialized('getConfigHash');

    return wickedStorage.configHash;
}

function _getExternalPortalHost() {
    debug('getExternalPortalHost()');
    checkInitialized('getExternalPortalHost');

    return checkNoSlash(getPortalHost());
}

function _getExternalPortalUrl() {
    debug('getExternalPortalUrl()');
    checkInitialized('getExternalPortalUrl');

    return checkSlash(_getSchema() + '://' + getPortalHost());
}

function _getExternalGatewayHost() {
    debug('getExternalGatewayHost()');
    checkInitialized('getExternalGatewayHost()');

    return checkNoSlash(getApiHost());
}

function _getExternalGatewayUrl() {
    debug('getExternalGatewayUrl()');
    checkInitialized('getExternalGatewayUrl');

    return checkSlash(_getSchema() + '://' + getApiHost());
}

function _getInternalApiUrl() {
    debug('getInternalApiUrl()');
    checkInitialized('getInternalApiUrl');

    return checkSlash(wickedStorage.apiUrl);
}

function _getPortalApiScope() {
    debug('getPortalApiScope()');
    checkInitialized('getPortalApiScope');

    if (wickedStorage.isV100OrHigher && wickedStorage.portalApiScope)
        return wickedStorage.portalApiScope;
    debug('WARNING: portalApiScope is not defined, or wicked API is <1.0.0');
    return '';
}

function _getInternalKongAdminUrl() {
    debug('getInternalKongAdminUrl()');
    checkInitialized('getInternalKongAdminUrl');

    return _getInternalUrl('kongAdminUrl', 'kong', 8001);
}

function _getInternalMailerUrl() {
    debug('getInternalMailerUrl');
    checkInitialized('getInternalMailerUrl');

    return _getInternalUrl('mailerUrl', 'portal-mailer', 3003);
}

function _getInternalChatbotUrl() {
    debug('getInternalChatbotUrl()');
    checkInitialized('getInternalChatbotUrl');

    return _getInternalUrl('chatbotUrl', 'portal-chatbot', 3004);
}

function _getInternalKongAdapterUrl() {
    debug('getInternalKongAdapterUrl()');
    checkInitialized('getInternalKongAdapterUrl');

    return _getInternalUrl('kongAdapterUrl', 'portal-kong-adapter', 3002);
}

function _getInternalKongOAuth2Url() {
    debug('getInternalKongOAuth2Url()');
    checkInitialized('getInternalKongOAuth2Url');

    return _getInternalUrl('kongOAuth2Url', 'portal-kong-oauth2', 3006);
}

function _getInternalUrl(globalSettingsProperty: string, defaultHost: string, defaultPort: number) {
    debug('getInternalUrl("' + globalSettingsProperty + '")');
    checkInitialized('getInternalUrl');

    if (wickedStorage.globals.network &&
        wickedStorage.globals.network.hasOwnProperty(globalSettingsProperty)) {
        return checkSlash(wickedStorage.globals.network[globalSettingsProperty]);
    }
    if (defaultHost && defaultPort)
        return checkSlash(guessServiceUrl(defaultHost, defaultPort));
    throw new Error('Configuration property "' + globalSettingsProperty + '" not defined in globals.json: network.');
}

// ======= UTILITY FUNCTIONS ======

function checkSlash(someUrl) {
    if (someUrl.endsWith('/'))
        return someUrl;
    return someUrl + '/';
}

function checkNoSlash(someUrl) {
    if (someUrl.endsWith('/'))
        return someUrl.substring(0, someUrl.length - 1);
    return someUrl;
}

function _getSchema() {
    checkInitialized('getSchema');
    if (wickedStorage.globals.network &&
        wickedStorage.globals.network.schema)
        return wickedStorage.globals.network.schema;
    console.error('In globals.json, network.schema is not defined. Defaulting to https.');
    return 'https';
}

function getPortalHost() {
    if (wickedStorage.globals.network &&
        wickedStorage.globals.network.portalHost)
        return wickedStorage.globals.network.portalHost;
    throw new Error('In globals.json, portalHost is not defined. Cannot return any default.');
}

function getApiHost() {
    if (wickedStorage.globals.network &&
        wickedStorage.globals.network.apiHost)
        return wickedStorage.globals.network.apiHost;
    throw new Error('In globals.json, apiHost is not defined. Cannot return any default.');
}

function checkInitialized(callingFunction) {
    if (!wickedStorage.initialized)
        throw new Error('Before calling ' + callingFunction + '(), initialize() must have been called and has to have returned successfully.');
}

function checkKongAdapterInitialized(callingFunction) {
    if (!wickedStorage.kongAdapterInitialized)
        throw new Error('Before calling ' + callingFunction + '(), awaitKongAdapter() must have been called and has to have returned successfully.');
}

function checkKongOAuth2Initialized(callingFunction) {
    if (!wickedStorage.kongOAuth2Initialized)
        throw new Error('Before calling ' + callingFunction + '(), awaitKongOAuth2() must have been called and has to have returned successfully.');
}

function guessServiceUrl(defaultHost, defaultPort) {
    debug('guessServiceUrl() - defaultHost: ' + defaultHost + ', defaultPort: ' + defaultPort);
    let url = 'http://' + defaultHost + ':' + defaultPort + '/';
    // Are we not running on Linux? Then guess we're in local development mode.
    if (os.type() != 'Linux') {
        const defaultLocalIP = getDefaultLocalIP();
        url = 'http://' + defaultLocalIP + ':' + defaultPort + '/';
    }
    debug(url);
    return url;
}

function resolveApiUrl() {
    let apiUrl = process.env.PORTAL_API_URL;
    if (!apiUrl) {
        apiUrl = guessServiceUrl('portal-api', '3001');
        console.error('Environment variable PORTAL_API_URL is not set, defaulting to ' + apiUrl + '. If this is not correct, please set before starting this process.');
    }
    if (!apiUrl.endsWith('/')) // Add trailing slash
        apiUrl += '/';
    return apiUrl;
}

function getDefaultLocalIP() {
    const localIPs = getLocalIPs();
    if (localIPs.length > 0)
        return localIPs[0];
    return "localhost";
}

function getLocalIPs() {
    debug('getLocalIPs()');
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (let k in interfaces) {
        for (let k2 in interfaces[k]) {
            const address = interfaces[k][k2];
            if (address.family === 'IPv4' && !address.internal) {
                addresses.push(address.address);
            }
        }
    }
    debug(addresses);
    return addresses;
}

function tryGet(url, statusCode, maxTries, tryCounter, timeout, callback) {
    debug('Try #' + tryCounter + ' to GET ' + url);
    request.get({ url: url, timeout: TRYGET_TIMEOUT }, function (err, res, body) {
        if (err || res.statusCode !== statusCode) {
            if (tryCounter < maxTries || maxTries < 0)
                return setTimeout(tryGet, timeout, url, statusCode, maxTries, tryCounter + 1, timeout, callback);
            debug('Giving up.');
            if (!err)
                err = new Error('Too many unsuccessful retries to GET ' + url + '. Gave up after ' + maxTries + ' tries.');
            return callback(err);
        }
        callback(null, body);
    });
}

function getJson(ob) {
    if (typeof ob === "string")
        return JSON.parse(ob);
    return ob;
}

function getText(ob) {
    if (ob instanceof String || typeof ob === "string")
        return ob;
    return JSON.stringify(ob, null, 2);
}

function _apiGet(urlPath, userId, scope, callback) {
    debug('apiGet(): ' + urlPath);
    checkInitialized('apiGet');
    if (arguments.length !== 4)
        throw new Error('apiGet was called with wrong number of arguments');

    apiAction('GET', urlPath, null, userId, scope, callback);
}

function _apiPost(urlPath, postBody, userId, callback) {
    debug('apiPost(): ' + urlPath);
    checkInitialized('apiPost');
    if (arguments.length !== 4)
        throw new Error('apiPost was called with wrong number of arguments');

    apiAction('POST', urlPath, postBody, userId, null, callback);
}

function _apiPut(urlPath, putBody, userId, callback) {
    debug('apiPut(): ' + urlPath);
    checkInitialized('apiPut');
    if (arguments.length !== 4)
        throw new Error('apiPut was called with wrong number of arguments');

    apiAction('PUT', urlPath, putBody, userId, null, callback);
}

function _apiPatch(urlPath, patchBody, userId, callback) {
    debug('apiPatch(): ' + urlPath);
    checkInitialized('apiPatch');
    if (arguments.length !== 4)
        throw new Error('apiPatch was called with wrong number of arguments');

    apiAction('PATCH', urlPath, patchBody, userId, null, callback);
}

function _apiDelete(urlPath, userId, callback) {
    debug('apiDelete(): ' + urlPath);
    checkInitialized('apiDelete');
    if (arguments.length !== 3)
        throw new Error('apiDelete was called with wrong number of arguments');

    apiAction('DELETE', urlPath, null, userId, null, callback);
}

function apiAction(method, urlPath, actionBody, userId, scope, callback) {
    debug('apiAction(' + method + '): ' + urlPath);
    if (arguments.length !== 6)
        throw new Error('apiAction called with wrong number of arguments');
    if (typeof (callback) !== 'function')
        throw new Error('apiAction: callback is not a function');

    if (!wickedStorage.apiReachable)
        return callback(new Error('The wicked API is currently not reachable. Try again later.'));
    if (wickedStorage.pendingExit)
        return callback(new Error('A shutdown due to changed configuration is pending.'));

    if (!scope) {
        if (wickedStorage.portalApiScope)
            scope = wickedStorage.portalApiScope;
        else
            scope = '';
    }
    debug(`apiAction: Using scope ${scope}`);

    if (actionBody)
        debug(actionBody);

    if (!userId && wickedStorage.machineUserId) {
        debug('Picking up machine user id: ' + wickedStorage.machineUserId);
        userId = wickedStorage.machineUserId;
    }

    if (urlPath.startsWith('/'))
        urlPath = urlPath.substring(1); // strip slash in beginning; it's in the API url

    const url = _getInternalApiUrl() + urlPath;
    debug(method + ' ' + url);
    const reqInfo: any = {
        method: method,
        url: url,
        timeout: WICKED_TIMEOUT
    };
    if (method != 'DELETE' &&
        method != 'GET') {
        // DELETE and GET ain't got no body.
        reqInfo.body = actionBody;
        reqInfo.json = true;
    }
    // This is the config hash we saw at init; send it to make sure we don't
    // run on an outdated configuration.
    reqInfo.headers = { 'X-Config-Hash': wickedStorage.configHash };
    if (userId) {
        if (wickedStorage.isV012OrHigher) {
            reqInfo.headers['X-Authenticated-UserId'] = userId;
        } else {
            reqInfo.headers['X-UserId'] = userId;
        }
    }
    if (wickedStorage.isV100OrHigher) {
        reqInfo.headers['X-Authenticated-Scope'] = scope;
    }
    if (wickedStorage.correlationId) {
        debug('Using correlation id: ' + wickedStorage.correlationId);
        reqInfo.headers['Correlation-Id'] = wickedStorage.correlationId;
    }
    if (wickedStorage.userAgent) {
        debug('Using User-Agent: ' + wickedStorage.userAgent);
        reqInfo.headers['User-Agent'] = wickedStorage.userAgent;
    }

    request(reqInfo, function (err, res, body) {
        if (err)
            return callback(err);
        if (res.statusCode > 299) {
            // Looks bad
            const err = new WickedError('api' + nice(method) + '() ' + urlPath + ' returned non-OK status code: ' + res.statusCode + ', check err.statusCode and err.body for details', res.statusCode, body);
            return callback(err);
        }
        if (res.statusCode !== 204) {
            const contentType = res.headers['content-type'];
            let returnValue = null;
            try {
                if (contentType.startsWith('text'))
                    returnValue = getText(body);
                else
                    returnValue = getJson(body);
            } catch (ex) {
                return callback(new Error('api' + nice(method) + '() ' + urlPath + ' returned non-parseable JSON: ' + ex.message));
            }
            return callback(null, returnValue);
        } else {
            // Empty response
            return callback(null);
        }
    });
}

function nice(methodName) {
    return methodName.substring(0, 1) + methodName.substring(1).toLowerCase();
}

// ====== OAUTH2 ======

function kongAdapterAction(method, url, body, callback) {
    const actionUrl = _getInternalKongAdapterUrl() + url;
    const reqBody: RequestBody = {
        method: method,
        url: actionUrl,
        timeout: KONG_TIMEOUT
    };
    if (method !== 'GET') {
        reqBody.json = true;
        reqBody.body = body;
    }
    request(reqBody, function (err, res, body) {
        if (err) {
            debug(method + ' to ' + actionUrl + ' failed.');
            debug(err);
            return callback(err);
        }
        if (res.statusCode > 299) {
            debug('Unexpected status code.');
            debug('Status Code: ' + res.statusCode);
            debug('Body: ' + body);
            const err = new WickedError(method + ' to ' + actionUrl + ' returned unexpected status code: ' + res.statusCode + '. Details in err.body and err.statusCode.', res.statusCode, body);
            return callback(err);
        }
        let jsonBody = null;
        try {
            jsonBody = getJson(body);
            debug(jsonBody);
        } catch (ex) {
            const err = new WickedError(method + ' to ' + actionUrl + ' returned non-parseable JSON: ' + ex.message + '. Possible details in err.body.', 500, body);
            return callback(err);
        }
        return callback(null, jsonBody);
    });
}

function _getRedirectUriWithAccessToken(userInfo, callback) {
    debug('getRedirectUriWithAccessToken()');
    _oauth2AuthorizeImplicit(userInfo, callback);
}

function _oauth2AuthorizeImplicit(userInfo, callback) {
    debug('oauth2AuthorizeImplicit()');
    checkInitialized('oauth2AuthorizeImplicit');
    checkKongAdapterInitialized('oauth2AuthorizeImplicit');

    if (!userInfo.client_id)
        return callback(new Error('client_id is mandatory'));
    if (!userInfo.api_id)
        return callback(new Error('api_id is mandatory'));
    if (!userInfo.authenticated_userid)
        return callback(new Error('authenticated_userid is mandatory'));
    if (!userInfo.auth_server)
        console.error('WARNING: wicked-sdk: oauth2AuthorizeImplicit() - auth_server is not passed in to call; this means it is not checked whether the API has the correct auth server configured.');

    kongAdapterAction('POST', 'oauth2/token/implicit', userInfo, function (err, redirectUri) {
        if (err)
            return callback(err);
        callback(null, redirectUri);
    });
}

function _oauth2GetAuthorizationCode(userInfo, callback) {
    debug('oauth2GetAuthorizationCode()');
    checkInitialized('oauth2GetAuthorizationCode');
    checkKongAdapterInitialized('oauth2GetAuthorizationCode');

    if (!userInfo.client_id)
        return callback(new Error('client_id is mandatory'));
    if (!userInfo.api_id)
        return callback(new Error('api_id is mandatory'));
    if (!userInfo.authenticated_userid)
        return callback(new Error('authenticated_userid is mandatory'));
    if (!userInfo.auth_server)
        console.error('WARNING: wicked-sdk: oauth2GetAuthorizationCode() - auth_server is not passed in to call; this means it is not checked whether the API has the correct auth server configured.');

    kongAdapterAction('POST', 'oauth2/token/code', userInfo, function (err, redirectUri) {
        if (err)
            return callback(err);
        callback(null, redirectUri);
    });
}

function _oauth2GetAccessTokenPasswordGrant(userInfo, callback) {
    debug('oauth2GetAccessTokenPasswordGrant()');
    checkInitialized('oauth2GetAccessTokenPasswordGrant');
    checkKongAdapterInitialized('oauth2GetAccessTokenPasswordGrant');

    if (!userInfo.client_id)
        return callback(new Error('client_id is mandatory'));
    if (!userInfo.api_id)
        return callback(new Error('api_id is mandatory'));
    if (!userInfo.authenticated_userid)
        return callback(new Error('authenticated_userid is mandatory'));
    if (!userInfo.auth_server)
        console.error('WARNING: wicked-sdk: oauth2GetAccessTokenPasswordGrant() - auth_server is not passed in to call; this means it is not checked whether the API has the correct auth server configured.');

    kongAdapterAction('POST', 'oauth2/token/password', userInfo, function (err, accessToken) {
        if (err)
            return callback(err);
        callback(null, accessToken);
    });
}

function _oauth2RefreshAccessToken(tokenInfo, callback) {
    debug('oauth2RefreshAccessToken');
    checkInitialized('oauth2RefreshAccessToken');
    checkKongAdapterInitialized('oauth2RefreshAccessToken');

    if (!tokenInfo.refresh_token)
        return callback(new Error('refresh_token is mandatory'));
    if (!tokenInfo.client_id)
        return callback(new Error('client_id is mandatory'));
    if (!tokenInfo.auth_server)
        console.error('WARNING: wicked-sdk: oauth2RefreshAccessToken() - auth_server is not passed in to call; this means it is not checked whether the API has the correct auth server configured.');

    kongAdapterAction('POST', 'oauth2/token/refresh', tokenInfo, function (err, accessToken) {
        if (err)
            return callback(err);
        callback(null, accessToken);
    });
}

function _oauth2GetAccessTokenInfo(accessToken, callback) {
    debug('oauth2GetAccessTokenInfo()');
    checkInitialized('oauth2GetAccessTokenInfo');
    checkKongAdapterInitialized('oauth2GetAccessTokenInfo');

    kongAdapterAction('GET', 'oauth2/token?access_token=' + qs.escape(accessToken), null, function (err, tokenInfo) {
        if (err)
            return callback(err);
        callback(null, tokenInfo);
    });
}

function _oauth2GetRefreshTokenInfo(refreshToken, callback) {
    debug('oauth2GetRefreshTokenInfo()');
    checkInitialized('oauth2GetRefreshTokenInfo');
    checkKongAdapterInitialized('oauth2GetRefreshTokenInfo');

    kongAdapterAction('GET', 'oauth2/token?refresh_token=' + qs.escape(refreshToken), null, function (err, tokenInfo) {
        if (err)
            return callback(err);
        callback(null, tokenInfo);
    });
}

function _revokeAccessToken(accessToken, callback) {
    debug(`revokeAccessToken(${accessToken})`);
    checkInitialized('revokeAccessToken()');
    checkKongAdapterInitialized('revokeAccessToken()');

    kongAdapterAction('DELETE', 'oauth2/token?access_token=' + qs.escape(accessToken), null, callback);
}

function _revokeAccessTokensByUserId(authenticatedUserId, callback) {
    debug(`revokeAccessTokenByUserId(${authenticatedUserId})`);
    checkInitialized('revokeAccessTokenByUserId()');
    checkKongAdapterInitialized('revokeAccessTokenByUserId()');

    kongAdapterAction('DELETE', 'oauth2/token?authenticated_userid=' + qs.escape(authenticatedUserId), null, callback);
}

function _getSubscriptionByClientId(clientId, apiId, callback) {
    debug('getSubscriptionByClientId()');
    checkInitialized('getSubscriptionByClientId');

    // Validate format of clientId
    if (!/^[a-zA-Z0-9\-]+$/.test(clientId)) {
        return callback(new Error('Invalid client_id format.'));
    }

    // Check whether we know this client ID, otherwise we won't bother.
    _apiGet('subscriptions/' + qs.escape(clientId), null, null, function (err, subsInfo) {
        if (err) {
            debug('GET of susbcription for client_id ' + clientId + ' failed.');
            debug(err);
            return callback(new Error('Could not identify application with given client_id.'));
        }
        debug('subscription info:');
        debug(subsInfo);
        if (!subsInfo.subscription)
            return callback(new Error('Could not successfully retrieve subscription information.'));
        if (subsInfo.subscription.api != apiId) {
            debug('subsInfo.api != apiId: ' + subsInfo.subscription.api + ' != ' + apiId);
            return callback(new Error('Bad request. The client_id does not match the API.'));
        }
        debug('Successfully identified application: ' + subsInfo.subscription.application);

        return callback(null, subsInfo);
    });
}

function kongOAuth2Action(method, url, body, errorOnUnexpectedStatusCode, callback) {
    const actionUrl = _getInternalKongOAuth2Url() + url;
    const reqBody: RequestBody = {
        method: method,
        url: actionUrl,
        timeout: KONG_TIMEOUT
    };
    if (method !== 'GET') {
        reqBody.json = true;
        reqBody.body = body;
    }
    request(reqBody, function (err, res, body) {
        if (err) {
            debug(method + ' to ' + actionUrl + ' failed.');
            debug(err);
            return callback(err);
        }
        if (errorOnUnexpectedStatusCode) {
            if (res.statusCode > 299) {
                debug('Unexpected status code.');
                debug('Status Code: ' + res.statusCode);
                debug('Body: ' + body);
                const err = new WickedError(method + ' to ' + actionUrl + ' returned unexpected status code: ' + res.statusCode + '. Details in err.body and err.statusCode.', res.statusCode, body);
                return callback(err);
            }
        }
        let jsonBody = null;
        try {
            jsonBody = getJson(body);
            debug(jsonBody);
        } catch (ex) {
            const err = new WickedError(method + ' to ' + actionUrl + ' returned non-parseable JSON: ' + ex.message + '. Possible details in err.body.', 500, body);
            return callback(err);
        }
        return callback(null, jsonBody);
    });
}

function _v1_oauth2Authorize(authRequest, callback) {
    debug('v1_oauth2Authorize()');
    checkInitialized('v1_oauth2Authorize()');
    checkKongOAuth2Initialized('v1_oauth2Authorize()');

    kongOAuth2Action('POST', 'oauth2/authorize', authRequest, false, callback);
}

function _v1_oauth2Token(tokenRequest, callback) {
    debug('v1_oauth2Token()');
    checkInitialized('v1_oauth2Token()');
    checkKongOAuth2Initialized('v1_oauth2Token()');

    kongOAuth2Action('POST', 'oauth2/token', tokenRequest, false, callback);
}

function _v1_oauth2GetAccessTokenInfo(accessToken, callback) {
    debug('v1_oauth2GetAccessTokenInfo()');
    checkInitialized('v1_oauth2GetAccessTokenInfo');
    checkKongOAuth2Initialized('v1_oauth2GetAccessTokenInfo');

    kongOAuth2Action('GET', 'oauth2_tokens?access_token=' + qs.escape(accessToken), null, true, function (err, tokenInfo) {
        if (err)
            return callback(err);
        callback(null, tokenInfo);
    });
}

function _v1_oauth2GetRefreshTokenInfo(refreshToken, callback) {
    debug('v1_oauth2GetRefreshTokenInfo()');
    checkInitialized('v1_oauth2GetRefreshTokenInfo');
    checkKongOAuth2Initialized('v1_oauth2GetRefreshTokenInfo');

    kongOAuth2Action('GET', 'oauth2_tokens?refresh_token=' + qs.escape(refreshToken), null, true, function (err, tokenInfo) {
        if (err)
            return callback(err);
        callback(null, tokenInfo);
    });
}

function _v1_revokeAccessToken(accessToken, callback) {
    debug(`v1_revokeAccessToken(${accessToken})`);
    checkInitialized('v1_revokeAccessToken()');
    checkKongOAuth2Initialized('v1_revokeAccessToken');

    kongOAuth2Action('DELETE', 'oauth2_tokens?access_token=' + qs.escape(accessToken), null, true, callback);
}

function _v1_revokeAccessTokensByUserId(authenticatedUserId, callback) {
    debug(`v1_revokeAccessTokensByUserId(${authenticatedUserId})`);
    checkInitialized('v1_revokeAccessTokensByUserId()');
    checkKongOAuth2Initialized('v1_revokeAccessTokensByUserId');

    kongOAuth2Action('DELETE', 'oauth2_tokens?authenticated_userid=' + qs.escape(authenticatedUserId), null, true, callback);
}