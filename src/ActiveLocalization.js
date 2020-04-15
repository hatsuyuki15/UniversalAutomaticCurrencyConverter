let _activeLocalizationInstance;

class ActiveLocalization {

    /***
     * @returns {ActiveLocalization}
     */
    static get instance() {
        if (!_activeLocalizationInstance) _activeLocalizationInstance = new ActiveLocalization();
        return _activeLocalizationInstance;
    }

    /**
     * @param {{config: Configuration, browser: Browser}} services
     */
    constructor(services = {}) {
        this._browser = services.browser || Browser.instance;
        this._localization = (services.config || Configuration.instance).localization;
        this.krone = null;
        this.yen = null;
        this.dollar = null;
        this._kroneKey = `uacc:site:localization:krone:${this._browser.hostname}`;
        this._yenKey = `uacc:site:localization:yen:${this._browser.hostname}`;
        this._dollarKey = `uacc:site:localization:dollar:${this._browser.hostname}`;
        this._lockedKey = `uacc:site:localization:locked:${this._browser.hostname}`;
        this._defaultKrone = null;
        this._defaultYen = null;
        this._defaultDollar = null;
    }

    /**
     * @returns {Promise<void>}
     */
    async load() {
        const result = await this._browser.loadLocal([this._kroneKey, this._yenKey, this._dollarKey]);

        // Use site specific localization first, if not found use global localization preference
        this.krone = result[this._kroneKey] || this._localization.krone.value;
        this.yen = result[this._yenKey] || this._localization.asian.value;
        this.dollar = result[this._dollarKey] || this._localization.dollar.value;

        this._defaultKrone = this.krone;
        this._defaultYen = this.yen;
        this._defaultDollar = this.dollar;
    }

    /**
     * @returns {Promise<void>}
     */
    async save() {
        await this._browser.saveLocal({
            [this._kroneKey]: this.krone,
            [this._yenKey]: this.yen,
            [this._dollarKey]: this.dollar,
        }, null);
    }

    /**
     * @param {boolean} bool
     * @returns {Promise<void>}
     */
    async lockSite(bool) {
        await this._browser.saveLocal(this._lockedKey, !!bool);
    }

    /**
     * @returns {Promise<void>}
     */
    async determineForSite() {
        const isLocked = (await this._browser.loadLocal([this._lockedKey]))[this._lockedKey];
        // If user has set the site to not be dynamically determined
        if (isLocked) return;

        throw 'unimplemented'

    }

}