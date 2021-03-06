let _detectorInstance;

class Detector {
    /**
     * @returns {Detector}
     */
    static get instance() {
        if (!_detectorInstance) _detectorInstance = new Detector();
        return _detectorInstance;
    }

    /**
     * @param {{config: Configuration, browser: Browser, currencies: Currencies, activeLocalization: ActiveLocalization}} services
     */
    constructor(services = {}) {
        this._config = services.config || Configuration.instance;
        this._browser = services.browser || Browser.instance;
        this._activeLocalization = services.activeLocalization || ActiveLocalization.instance;
        this._currencies = services.currencies || Currencies.instance;
        this._regex = null;
        this._currencyTags = null;
        this._localizationMapping = Localizations.allUniqueLocalizationMappings;
        this._disabledCurrencies = {};
        this._config.disabledCurrencies.tags.value.forEach(v => this._disabledCurrencies[v] = true);
    }

    _currencyRegex(name) {
        // Simplification of Localizations' symbols
        return `(?<currency${name}>${Object.values(Localizations.unique)
            .flatMap(e => e)
            .map(e => e.replace('$', '\\$'))
            .concat([
                /[A-Z]{3}/.source,
                /,-{1,2}/.source,
                /kr\.?/.source,
                '¥',
                /\$/.source,
                'dollar',
                'dollars',
            ]).join('|')})?`;
    }

    _integerRegex(number) {
        // Regex for parts
        const neg = /[-]?/.source
        const integer = /(?:(?:\d{1,3}?(?:[., ]\d{3})*)|\d{4,})/.source

        // Group naming for catching
        const negGroup = `(?<neg${number}>${neg})`
        const integerGroup = `(?<integer${number}>${integer})`;

        // Final collection
        return `(?<full_integer${number}>${negGroup}${integerGroup})`;
    }

    _decimalRegex(number) {
        // Regex for parts
        const decimalPoint = /\s*[,.]\s*/.source
        const decimal = /\d+|-{2}/.source

        // Group naming for catching
        const decimalPointGroup = `(?<decimalPoint${number}>${decimalPoint})`;
        const decimalGroup = `(?<decimal${number}>${decimal})`;

        // Final collection
        return `(?<full_decimal${number}>${decimalPointGroup}${decimalGroup})?`;
    }

    _amountRegex(number) {
        return `(?<amount${number}>${this._integerRegex(number)}${this._decimalRegex(number)})`;
    }

    _rangeAmountRegex() {
        const innerRange = /\s*\-\s*/.source
        const innerRangeGroup = `(?<range_inner>${innerRange})`
        const range = `(?:${innerRangeGroup}${this._amountRegex('Right')})?`;
        return `(?<full_range>${this._amountRegex('Left')}${range})`;
    }

    /**
     * If forceNew is false, a shared cached instance is used
     * shared instance should only be used in one place at a time
     * @param {boolean} forceNew
     * @returns {RegularExpression}
     */
    regex(forceNew = false) {
        if (this._regex && !forceNew) {
            this._regex.lastIndex = 0;
            return this._regex;
        }
        const s = /["‎+\-:|\`^'& ,.<>()\\/\s*]/.source;
        const start = `(?<start>${s}|^)`;
        const end = `(?<end>${s}|$)`;
        const whitespace = /\s*/.source;
        const regex = [
            start,
            this._currencyRegex('Left'),
            `(?<whitespaceLeft>${whitespace})`,
            this._rangeAmountRegex(),
            `(?<whitespaceRight>${whitespace})`,
            this._currencyRegex('Right'),
            end,
        ].join('');

        if (forceNew) return this._constructRegex(regex);

        this._regex = this._constructRegex(regex);
        this._regex.lastIndex = 0;
        return this._regex;
    }

    _constructRegex(regex) {
        return RegularExpression.create(regex, 'gm', this._browser.isFirefox);
    }

    /**
     * @param {*} element
     * @returns {Promise<[CurrencyElement]>}
     */
    async detectAllElements(element) {
        if (element.hasAttribute('uacc:watched')) return null;
        const raw = element.innerText;
        if (!element.tagName || element.tagName.toLowerCase() === 'script') return [];
        if (!this.regex().test(raw)) return [];
        if ((await this.detectResult(raw)).length === 0) return [];

        const children = element.children;
        let result = [];
        let hasUACCWatchedUnder = false;
        for (let i = 0; i < children.length; i++) {
            const found = await this.detectAllElements(children[i]);
            if (!found) hasUACCWatchedUnder = true;
            else result = result.concat(found);
        }

        if (result.length === 0 && hasUACCWatchedUnder)
            return null;
        else if (result.length > 0)
            return result;
        else if (!hasUACCWatchedUnder && !this._hasChildDeeperThan(element, 4)) {
            element.setAttribute('uacc:watched', 'true');
            return [new CurrencyElement(element, {
                detector: this,
                currencies: this._currencies,
                config: this._config
            })];
        } else return []
    }

    /**
     * @param {string} text
     * @returns {Promise<[{
            amount: CurrencyAmount,
            data: [{start: number, length: number, replace: boolean}]
        }]>}
     */
    async detectResult(text) {
        const regex = this.regex(true);
        const result = [];
        let regexResult;
        while (regexResult = regex.exec(text)) {
            // Allow reuse of start/end characters in capture
            if (regexResult[0].length > 1)
                regex.lastIndex--;

            const data = {
                amount: null,
                data: []
            };
            const keys = [
                'negLeft',
                'integerLeft',
                'decimalPointLeft',
                'decimalLeft',
                'range_inner',
                'negRight',
                'integerRight',
                'decimalPointRight',
                'decimalRight',
            ];

            // Determine if amounts found are valid
            const amounts = [];
            const amountLeft = this._determineAmount(
                regexResult.groups['negLeft'],
                regexResult.groups['integerLeft'],
                regexResult.groups['decimalLeft']);
            if (amountLeft || amountLeft === 0) amounts.push(amountLeft);
            const amountRight = this._determineAmount(
                regexResult.groups['negRight'],
                regexResult.groups['integerRight'],
                regexResult.groups['decimalRight']);
            if (amountRight || amountRight === 0) amounts.push(amountRight);
            if (amounts.length === 0) continue;

            // Determine which sides of the amount has currency symbol (both can have, but then right side is prioritized)
            const currencyLeft = regexResult.groups['currencyLeft'];
            let at = regexResult.index + (regexResult.groups.start || '').length;
            let currency = await this._determineCurrency(currencyLeft);
            if (currency) {
                // If currency tag, add for removal
                keys.unshift('whitespaceLeft');
                keys.unshift('currencyLeft');
            } else at +=
                +(regexResult.groups.currencyLeft || '').length
                + (regexResult.groups.whitespaceLeft || '').length;

            const currencyRight = regexResult.groups['currencyRight'];
            const tempCurrency = await this._determineCurrency(currencyRight);
            if (tempCurrency) {
                // If currency tag, add for removal
                keys.push('whitespaceRight');
                keys.push('currencyRight');
                currency = tempCurrency;
            }
            if (!currency) continue;

            data.amount = new CurrencyAmount(currency, amounts, {config: this._config, currencies: this._currencies})
            keys.forEach(key => {
                const group = regexResult.groups[key];
                if (!group) return;
                data.data.push({start: at, length: group.length, original: group, replace: key === 'integerLeft'});
                at += group.length;
            });
            result.push(data);
        }
        return result;
    }

    /**
     * @param {string} neg
     * @param {string} int
     * @param {string} dec
     * @returns {number}
     * @private
     */
    _determineAmount(neg, int, dec) {
        if (!int) return NaN;
        neg = neg || '';
        int = int.replace(/[^0-9]/g, '');
        dec = dec || '';
        return Number(neg + int + '.' + dec)
    }

    /**
     * @param {string} found
     * @returns {Promise<string>}
     * @private
     */
    async _determineCurrency(found) {
        if (!found) return null;

        found = this._localizationMapping[found] || found;
        const symbols = await this._currencies.symbols();
        if (!found || !symbols[found])
            return null;

        if (this._disabledCurrencies[found])
            return null;

        return found;
    }

    /**
     * @param {*} element
     * @param {number} maxDepth
     * @returns {boolean}
     * @private
     */
    _hasChildDeeperThan(element, maxDepth) {
        if (!element) return maxDepth >= 0;
        const children = element.children
        for (let i = 0; i < children.length; i++)
            if (this._hasChildDeeperThan(children[i], maxDepth - 1))
                return true;
        return false;
    }

    // Has to be called EVERY time localization changes for a site
    updateSharedLocalizations() {
        this._localizationMapping['$'] = this._activeLocalization.dollar;
        this._localizationMapping['dollar'] = this._activeLocalization.dollar;
        this._localizationMapping['dollars'] = this._activeLocalization.dollar;
        this._localizationMapping['kr.'] = this._activeLocalization.krone;
        this._localizationMapping['kr'] = this._activeLocalization.krone;
        this._localizationMapping[',-'] = this._activeLocalization.krone;
        this._localizationMapping['¥'] = this._activeLocalization.yen;
    }

    async updateSymbols() {
        this._currencyTags = await this._currencies.symbols();
    }
}