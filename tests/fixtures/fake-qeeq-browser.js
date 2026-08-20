const apiFixture = require('./qeeq-search-list-ktw.json');
const domFixture = require('./qeeq-expanded-group-ktw.json');
const airportFixture = require('./qeeq-airport-autocomplete.json');

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
  openGroup: '[class*="car-group-item___"][class*="group-open___"]',
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
    contextCloseAttempts: 0,
    browserCloseAttempts: 0,
    selectedSuggestionIata: null,
    hiddenSearchValues: {},
    driverAge: null,
    residenceCountryCode: null,
    semanticLabelsUsed: [],
    loadMoreClicks: 0,
    supplierButtonClicks: 0,
    submitted: false,
    responseListenerAttachedBeforeSubmit: false,
    observedRequestUrls: [],
    popupClicks: { optionalCookies: 0, lowerBanner: 0 },
    responseListeners: 0,
    primaryProfileControls: options.primaryProfileControls !== false,
    hiddenFirstControls: options.hiddenFirstControls === true,
    loadMoreCounts: options.loadMoreCounts || [25, 50, 50],
    loadMoreDelayPolls: options.loadMoreDelayPolls || [],
    currentGroupCount: (options.loadMoreCounts || [25, 50, 50])[0],
    pendingGroupCount: null,
    pendingGroupPolls: 0,
    loadMoreDisappeared: false,
    responseSequence: options.responseSequence || [{
      payload: options.networkPayload || apiFixture,
      url: options.networkUrl || 'https://www.qeeq.pl/car-api/search/list?page=1'
    }],
    hiddenValueOverrides: options.hiddenValueOverrides || {},
    failSessions: new Set(options.failSessions || []),
    pages: [],
    clockMs: 0
  };

  state.now = () => new Date(1_700_000_000_000 + state.clockMs);
  state.sleep = async milliseconds => {
    state.clockMs += Number(milliseconds) || 0;
    for (const page of state.pages) {
      if (page.autocompletePollsRemaining > 0) page.autocompletePollsRemaining -= 1;
      if (page.expansionPollsRemaining > 0) page.expansionPollsRemaining -= 1;
    }
    if (state.pendingGroupPolls > 0) {
      state.pendingGroupPolls -= 1;
      if (state.pendingGroupPolls === 0 && state.pendingGroupCount !== null) {
        state.currentGroupCount = state.pendingGroupCount;
        state.pendingGroupCount = null;
      }
    }
  };

  class FakeLocator {
    constructor(page, kind, data = {}) {
      this.page = page;
      this.kind = kind;
      this.data = data;
    }

    async count() {
      const terminalLoadMoreStall = state.loadMoreClicks >= state.loadMoreCounts.length - 1
        && state.loadMoreCounts.length > 1
        && state.loadMoreCounts.at(-1) === state.loadMoreCounts.at(-2);
      if (this.kind === 'suggestions') return this.page.suggestions().length;
      if (this.kind === 'popup') return this.page.popups[this.data.label] ? (state.hiddenFirstControls ? 2 : 1) : 0;
      if (['pickupInput', 'dateOrTime', 'submit'].includes(this.kind)) return state.hiddenFirstControls ? 2 : 1;
      if (this.kind === 'loadMore') return !state.loadMoreDisappeared && (state.pendingGroupCount !== null || state.loadMoreClicks < state.loadMoreCounts.length - 1 || terminalLoadMoreStall) ? 1 : 0;
      if (this.kind === 'profile') return state.primaryProfileControls ? (state.hiddenFirstControls ? 2 : 1) : 0;
      if (this.kind === 'semanticProfile') return state.primaryProfileControls ? 0 : (state.hiddenFirstControls ? 2 : 1);
      if (this.kind === 'groups') return state.currentGroupCount;
      if (this.kind === 'supplierButton') return this.data.index === 0 ? 1 : 0;
      if (this.kind === 'reserveAnchor') return this.data.index === 0 && this.page.groupOpen ? 1 : 0;
      if (this.kind === 'referencePrice') return 0;
      return 1;
    }

    async isVisible() {
      const terminalLoadMoreStall = state.loadMoreClicks >= state.loadMoreCounts.length - 1
        && state.loadMoreCounts.length > 1
        && state.loadMoreCounts.at(-1) === state.loadMoreCounts.at(-2);
      if (this.kind === 'suggestion') return this.data.visible;
      if (['popup', 'profile', 'semanticProfile', 'pickupInput', 'dateOrTime', 'submit'].includes(this.kind)
        && state.hiddenFirstControls && this.data.index === 0) return false;
      if (this.kind === 'popup') return Boolean(this.page.popups[this.data.label]);
      if (this.kind === 'loadMore') return !state.loadMoreDisappeared && (state.pendingGroupCount !== null || state.loadMoreClicks < state.loadMoreCounts.length - 1 || terminalLoadMoreStall);
      if (this.kind === 'reserveAnchor') return (await this.count()) > 0 && this.page.expansionPollsRemaining === 0;
      return (await this.count()) > 0;
    }

    first() {
      return this.nth(0);
    }

    nth(index) {
      if (this.kind === 'suggestions') {
        return new FakeLocator(this.page, 'suggestion', this.page.suggestions()[index]);
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
      if (state.hiddenFirstControls && ['pickupInput', 'dateOrTime'].includes(this.kind) && this.data.index === undefined) {
        throw new Error('strict_mode_violation');
      }
      state.actions.push(['fill', this.kind, value, this.data.index ?? 0]);
      if (this.kind === 'pickupInput') {
        this.page.pickupQuery = value;
        this.page.autocompletePollsRemaining = options.autocompleteDelayPolls || 0;
      }
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
      if (state.hiddenFirstControls && this.kind === 'submit' && this.data.index === undefined) {
        throw new Error('strict_mode_violation');
      }
      state.actions.push(['click', this.kind, this.data.label || this.data.iata || null, this.data.index ?? 0]);
      if (this.kind === 'suggestion') state.selectedSuggestionIata = this.data.iata;
      if (this.kind === 'popup') {
        this.page.popups[this.data.label] = false;
        if (this.data.label === 'Odrzuć nieobowiązkowe pliki cookie') state.popupClicks.optionalCookies += 1;
        if (this.data.label === 'OK') state.popupClicks.lowerBanner += 1;
      }
      if (this.kind === 'supplierButton') {
        state.supplierButtonClicks += 1;
        this.page.groupOpen = true;
        this.page.expansionPollsRemaining = options.expansionDelayPolls || 0;
      }
      if (this.kind === 'loadMore') {
        state.loadMoreClicks += 1;
        const nextCount = state.loadMoreCounts[Math.min(state.loadMoreClicks, state.loadMoreCounts.length - 1)];
        const delay = state.loadMoreDelayPolls[state.loadMoreClicks - 1] || 0;
        if (delay > 0) {
          state.pendingGroupCount = nextCount;
          state.pendingGroupPolls = delay;
        } else {
          state.currentGroupCount = nextCount;
        }
        if (options.loadMoreDisappearsAfterClick === state.loadMoreClicks) state.loadMoreDisappeared = true;
      }
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
        if (name === 'data-city') return this.data.city || null;
        if (name === 'data-landmark') return this.data.landmark || null;
        if (name === 'data-data-type') return this.data.dataType || null;
        if (name === 'type') return this.data.type || null;
      }
      if (this.kind === 'group' && name === 'class') return this.page.groupOpen && this.data.index === 0 ? 'car-group-item___x group-open___x' : 'car-group-item___x';
      if (this.kind === 'reserveAnchor') {
        if (name === 'id') return domFixture.offer.businessId;
        if (name === 'bid') return domFixture.offer.businessBid;
        if (name === 'list_discount_type') return domFixture.offer.discountType;
      }
      return null;
    }

    async evaluate(_callback, selector) {
      if (this.kind === 'group' && selector === SELECTORS.openGroup) return this.page.groupOpen && this.data.index === 0;
      return false;
    }
  }

  class FakePage {
    constructor(sessionNumber) {
      this.sessionNumber = sessionNumber;
      this.listeners = new Map();
      this.currentUrl = 'about:blank';
      this.sameLocation = false;
      this.groupOpen = options.initiallyOpen === true;
      this.expansionPollsRemaining = 0;
      this.pickupQuery = null;
      this.autocompletePollsRemaining = 0;
      this.popups = {
        'Odrzuć nieobowiązkowe pliki cookie': true,
        OK: true
      };
      state.pages.push(this);
    }

    suggestions() {
      const stale = { visible: false, iata: 'WRO', label: 'Lotnisko we Wrocławiu' };
      if (options.staleExactSuggestion) {
        const exact = airportFixture.find(item => item.iata === 'KTW');
        return [stale, { ...exact, visible: true }];
      }
      if (this.autocompletePollsRemaining > 0) return [stale];
      if (!this.pickupQuery) return [stale];
      const queryIata = String(this.pickupQuery || '').trim().toUpperCase();
      const normalizedQuery = String(this.pickupQuery || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const fixtureMatch = airportFixture.find(item => item.iata === queryIata)
        || airportFixture.find(item => item.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === normalizedQuery);
      const current = fixtureMatch || airportFixture.find(item => item.iata === 'KTW');
      const override = options.autocompleteOverrides?.[current.iata];
      if (override === 'missing') return [stale];
      const visible = { ...current, visible: true };
      if (override === 'ambiguous') return [stale, visible, { ...visible }];
      return [stale, visible];
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
      if (selector === SELECTORS.openGroup) return new FakeLocator(this, 'openGroups');
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
      state.responseListeners = handlers.length;
    }

    off(event, handler) {
      const handlers = this.listeners.get(event) || [];
      this.listeners.set(event, handlers.filter(candidate => candidate !== handler));
      state.responseListeners = this.listeners.get(event).length;
    }

    async submit() {
      state.submitted = true;
      state.responseListenerAttachedBeforeSubmit = (this.listeners.get('response') || []).length > 0;
      const emit = entry => {
        state.observedRequestUrls.push(entry.url);
        const response = {
          url: () => entry.url,
          request: () => ({ method: () => 'GET' }),
          json: async () => {
            state.clockMs += entry.jsonCostMs || 0;
            if (entry.jsonDelayMs) await new Promise(resolve => setTimeout(resolve, entry.jsonDelayMs));
            if (entry.jsonError) throw new Error('fake response parse failure');
            return entry.payload;
          }
        };
        for (const handler of this.listeners.get('response') || []) handler(response);
      };
      for (const entry of state.responseSequence) {
        if (entry.emitDelayMs) setTimeout(() => emit(entry), entry.emitDelayMs);
        else emit(entry);
      }
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
        return {
          newPage: async () => page,
          close: async () => {
            state.contextCloseAttempts += 1;
            if (options.contextCloseError) {
              const error = new Error(options.contextCloseError);
              error.code = options.contextCloseError;
              throw error;
            }
          }
        };
      },
      close: async () => {
        state.browserCloseAttempts += 1;
        if (options.browserCloseError) {
          const error = new Error(options.browserCloseError);
          error.code = options.browserCloseError;
          throw error;
        }
      }
    };
  };

  return state;
}

module.exports = { createFakeQeeqBrowser };
