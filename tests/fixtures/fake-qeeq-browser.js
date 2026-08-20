const apiFixture = require('./qeeq-search-list-ktw.json');
const domFixture = require('./qeeq-expanded-group-ktw.json');

const SELECTORS = {
  pickupInput: 'input[name="pickup"], .J-pick-up-input',
  pickupSuggestion: 'li.auto-com-item[data-role="item"]:visible',
  pickupDate: '.J-os-search-pick-date',
  pickupTime: '.J-os-search-pick-time',
  returnDate: '.J-os-search-return-date',
  returnTime: '.J-os-search-return-time',
  pickupDateValue: 'input[name="from_date_0"]',
  pickupTimeValue: 'input[name="from_date_1"]',
  returnDateValue: 'input[name="to_date_0"]',
  returnTimeValue: 'input[name="to_date_1"]',
  sameLocation: '.J-all-the-place',
  driverAge: '.J-search-age-input',
  residence: '.J-search-region-input',
  submit: '.J-search-submit',
  group: '[class*="car-group-item___"]',
  vehicleName: '[class*="car_name___"]',
  supplierButton: 'button[class*="suppliers-btn"]',
  reserveAnchor: 'a[data-tj="reserve_btn_regular_click_b"]',
  supplierInfo: '.supplier-info',
  supplierRating: '.supplier-info > div:first-child > div:last-child',
  feature: '.car-feature-item',
  displayedPrice: '[class*="origin-row-price___"]',
  diamondPrice: '[class*="diamond-row___"]',
  referencePrice: '[class*="line-through"], [class*="origin-price-tag"]',
  rentalDays: '[class*="rental-days___"]'
};

function createFakeQeeqBrowser(options = {}) {
  const state = {
    actions: [],
    browserLaunches: 0,
    contextsCreated: 0,
    selectedSuggestionIata: null,
    hiddenSearchValues: {},
    driverAge: null,
    residenceCountryCode: null,
    semanticLabelsUsed: [],
    loadMoreClicks: 0,
    submitted: false,
    responseListenerAttachedBeforeSubmit: false,
    observedRequestUrls: [],
    popupClicks: { optionalCookies: 0, lowerBanner: 0 },
    primaryProfileControls: options.primaryProfileControls !== false,
    loadMoreCounts: options.loadMoreCounts || [25, 50, 50],
    networkPayload: options.networkPayload || apiFixture,
    networkUrl: options.networkUrl || 'https://www.qeeq.pl/car-api/search/list?page=1',
    hiddenValueOverrides: options.hiddenValueOverrides || {},
    failSessions: new Set(options.failSessions || [])
  };

  class FakeLocator {
    constructor(page, kind, data = {}) {
      this.page = page;
      this.kind = kind;
      this.data = data;
    }

    async count() {
      if (this.kind === 'suggestions') return 2;
      if (this.kind === 'popup') return this.page.popups[this.data.label] ? 1 : 0;
      if (this.kind === 'loadMore') return state.loadMoreClicks < state.loadMoreCounts.length - 1 ? 1 : 0;
      if (this.kind === 'profile') return state.primaryProfileControls ? 1 : 0;
      if (this.kind === 'semanticProfile') return state.primaryProfileControls ? 0 : 1;
      if (this.kind === 'groups') return state.loadMoreCounts[Math.min(state.loadMoreClicks, state.loadMoreCounts.length - 1)];
      if (this.kind === 'supplierButton') return this.data.index === 0 ? 1 : 0;
      if (this.kind === 'reserveAnchor') return this.data.index === 0 && this.page.expanded ? 1 : 0;
      if (this.kind === 'referencePrice') return 0;
      return 1;
    }

    async isVisible() {
      if (this.kind === 'suggestion') return this.data.visible;
      if (this.kind === 'popup') return Boolean(this.page.popups[this.data.label]);
      if (this.kind === 'loadMore') return state.loadMoreClicks < state.loadMoreCounts.length - 1;
      return (await this.count()) > 0;
    }

    first() {
      return this.nth(0);
    }

    nth(index) {
      if (this.kind === 'suggestions') {
        return new FakeLocator(this.page, 'suggestion', index === 0
          ? { visible: false, iata: 'WRO', label: 'Lotnisko we Wrocławiu' }
          : { visible: true, iata: 'KTW', label: 'Port Lotniczy Katowice-Pyrzowice' });
      }
      if (this.kind === 'groups') return new FakeLocator(this.page, 'group', { index });
      return new FakeLocator(this.page, this.kind, { ...this.data, index });
    }

    locator(selector) {
      if (this.kind === 'group' && selector === SELECTORS.vehicleName) return new FakeLocator(this.page, 'vehicleName', this.data);
      if (this.kind === 'group' && selector === SELECTORS.supplierButton) return new FakeLocator(this.page, 'supplierButton', this.data);
      if (this.kind === 'group' && selector === SELECTORS.reserveAnchor) return new FakeLocator(this.page, 'reserveAnchor', this.data);
      if (this.kind === 'reserveAnchor' && selector.startsWith('xpath=ancestor::')) return new FakeLocator(this.page, 'offerSubtree', this.data);
      if (this.kind === 'offerSubtree' && selector === SELECTORS.supplierInfo) return new FakeLocator(this.page, 'supplierInfo', this.data);
      if (this.kind === 'offerSubtree' && selector === SELECTORS.supplierRating) return new FakeLocator(this.page, 'supplierRating', this.data);
      if (this.kind === 'offerSubtree' && selector === SELECTORS.feature) return new FakeLocator(this.page, 'features', this.data);
      if (this.kind === 'offerSubtree' && selector === SELECTORS.displayedPrice) return new FakeLocator(this.page, 'displayedPrice', this.data);
      if (this.kind === 'offerSubtree' && selector === SELECTORS.diamondPrice) return new FakeLocator(this.page, 'diamondPrice', this.data);
      if (this.kind === 'offerSubtree' && selector === SELECTORS.referencePrice) return new FakeLocator(this.page, 'referencePrice', this.data);
      if (this.kind === 'offerSubtree' && selector === SELECTORS.rentalDays) return new FakeLocator(this.page, 'rentalDays', this.data);
      return new FakeLocator(this.page, 'unknown', { selector });
    }

    async fill(value) {
      state.actions.push(['fill', this.kind, value]);
      if (this.kind === 'dateOrTime') {
        const hiddenName = this.data.hiddenName;
        state.hiddenSearchValues[hiddenName] = state.hiddenValueOverrides[hiddenName] ?? value;
      }
      if (this.kind === 'profile' || this.kind === 'semanticProfile') {
        if (this.kind === 'semanticProfile') state.semanticLabelsUsed.push(this.data.label);
        state[this.data.field] = value;
      }
    }

    async selectOption(value) {
      await this.fill(value);
    }

    async click() {
      state.actions.push(['click', this.kind, this.data.label || this.data.iata || null]);
      if (this.kind === 'suggestion') state.selectedSuggestionIata = this.data.iata;
      if (this.kind === 'popup') {
        this.page.popups[this.data.label] = false;
        if (this.data.label === 'Odrzuć nieobowiązkowe pliki cookie') state.popupClicks.optionalCookies += 1;
        if (this.data.label === 'OK') state.popupClicks.lowerBanner += 1;
      }
      if (this.kind === 'supplierButton') this.page.expanded = true;
      if (this.kind === 'loadMore') state.loadMoreClicks += 1;
      if (this.kind === 'sameLocation') this.page.sameLocation = true;
      if (this.kind === 'submit') await this.page.submit();
    }

    async inputValue() {
      if (this.kind === 'hidden') return state.hiddenSearchValues[this.data.name] ?? '';
      if (this.kind === 'profile' || this.kind === 'semanticProfile') return state[this.data.field] ?? '';
      return '';
    }

    async isChecked() {
      return this.page.sameLocation;
    }

    async innerText() {
      if (this.kind === 'suggestion') return `${this.data.label} (${this.data.iata})`;
      if (this.kind === 'vehicleName') return this.data.index === 0 ? domFixture.vehicle.vehicleName : `Vehicle ${this.data.index + 1}`;
      if (this.kind === 'supplierInfo') return 'CARWIZ 8.5 (120)';
      if (this.kind === 'supplierRating') return '8.5 (120)';
      if (this.kind === 'displayedPrice') return domFixture.offer.displayedAmount;
      if (this.kind === 'diamondPrice') return domFixture.offer.diamondAmount;
      if (this.kind === 'rentalDays') return domFixture.offer.rentalPeriodText;
      return '';
    }

    async allTextContents() {
      if (this.kind === 'features') return ['Automatyczna', domFixture.offer.depositText, '5 miejsc', '5 drzwi', '1 bagaż'];
      return [];
    }

    async getAttribute(name) {
      if (this.kind === 'suggestion') {
        if (name === 'data-iata') return this.data.iata;
        if (name === 'title') return this.data.label;
      }
      if (this.kind === 'reserveAnchor') {
        if (name === 'id') return domFixture.offer.businessId;
        if (name === 'bid') return domFixture.offer.businessBid;
        if (name === 'list_discount_type') return domFixture.offer.discountType;
      }
      return null;
    }
  }

  class FakePage {
    constructor(sessionNumber) {
      this.sessionNumber = sessionNumber;
      this.listeners = new Map();
      this.currentUrl = 'about:blank';
      this.sameLocation = false;
      this.expanded = false;
      this.popups = {
        'Odrzuć nieobowiązkowe pliki cookie': true,
        OK: true
      };
    }

    async goto(url) {
      state.actions.push(['goto', url]);
      this.currentUrl = url;
      if (state.failSessions.has(this.sessionNumber)) {
        const error = new Error('session expired');
        error.code = 'session_expired';
        throw error;
      }
    }

    locator(selector) {
      const dateFields = {
        [SELECTORS.pickupDate]: 'from_date_0',
        [SELECTORS.pickupTime]: 'from_date_1',
        [SELECTORS.returnDate]: 'to_date_0',
        [SELECTORS.returnTime]: 'to_date_1'
      };
      const hiddenFields = {
        [SELECTORS.pickupDateValue]: 'from_date_0',
        [SELECTORS.pickupTimeValue]: 'from_date_1',
        [SELECTORS.returnDateValue]: 'to_date_0',
        [SELECTORS.returnTimeValue]: 'to_date_1'
      };
      if (selector === SELECTORS.pickupInput) return new FakeLocator(this, 'pickupInput');
      if (selector === SELECTORS.pickupSuggestion) return new FakeLocator(this, 'suggestions');
      if (selector in dateFields) return new FakeLocator(this, 'dateOrTime', { hiddenName: dateFields[selector] });
      if (selector in hiddenFields) return new FakeLocator(this, 'hidden', { name: hiddenFields[selector] });
      if (selector === SELECTORS.sameLocation) return new FakeLocator(this, 'sameLocation');
      if (selector === SELECTORS.driverAge) return new FakeLocator(this, 'profile', { field: 'driverAge' });
      if (selector === SELECTORS.residence) return new FakeLocator(this, 'profile', { field: 'residenceCountryCode' });
      if (selector === SELECTORS.submit) return new FakeLocator(this, 'submit');
      if (selector === SELECTORS.group) return new FakeLocator(this, 'groups');
      return new FakeLocator(this, 'unknown', { selector });
    }

    getByText(label) {
      if (label === 'Pokaż więcej wyników') return new FakeLocator(this, 'loadMore', { label });
      return new FakeLocator(this, 'popup', { label });
    }

    getByLabel(label) {
      const field = label === 'Wiek kierowcy' ? 'driverAge' : 'residenceCountryCode';
      return new FakeLocator(this, 'semanticProfile', { field, label });
    }

    on(event, handler) {
      const handlers = this.listeners.get(event) || [];
      handlers.push(handler);
      this.listeners.set(event, handlers);
    }

    off(event, handler) {
      const handlers = this.listeners.get(event) || [];
      this.listeners.set(event, handlers.filter(candidate => candidate !== handler));
    }

    async submit() {
      state.submitted = true;
      state.responseListenerAttachedBeforeSubmit = (this.listeners.get('response') || []).length > 0;
      state.observedRequestUrls.push(state.networkUrl);
      const response = {
        url: () => state.networkUrl,
        request: () => ({ method: () => 'GET' }),
        json: async () => state.networkPayload
      };
      for (const handler of this.listeners.get('response') || []) handler(response);
      const resultUrl = new URL('https://www.qeeq.pl/car/search');
      resultUrl.searchParams.set('id', 'fake-session');
      this.currentUrl = resultUrl.toString();
    }

    async waitForURL(pattern) {
      if (!pattern.test(this.currentUrl)) throw new Error(`URL did not match: ${this.currentUrl}`);
    }

    async waitForSelector() {}

    url() {
      return this.currentUrl;
    }
  }

  state.launchBrowser = async () => {
    state.browserLaunches += 1;
    return {
      newContext: async () => {
        state.contextsCreated += 1;
        const page = new FakePage(state.contextsCreated);
        return { newPage: async () => page, close: async () => {} };
      },
      close: async () => {}
    };
  };

  return state;
}

module.exports = { createFakeQeeqBrowser };
