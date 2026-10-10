/**
 * MULE SHIELD Centralized Logo Component & Branding Utility
 * Provides consistent, official emblem rendering across all application surfaces.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MuleShieldLogo = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LOGO_CONFIG = {
    svgPath: 'assets/mule-shield-logo.svg',
    pngFallback: 'assets/mule-shield-logo.png',
    defaultAlt: 'MULE SHIELD logo',
    brandName: 'MULE SHIELD',
    badgeText: 'AML FORENSICS'
  };

  /**
   * Generates HTML markup string for the MULE SHIELD Logo
   * @param {Object} options Configuration options
   * @returns {string} HTML string
   */
  function render(options = {}) {
    const {
      variant = 'full', // 'full' | 'symbol' | 'sidebar' | 'navbar' | 'compact' | 'loading' | 'empty' | 'report'
      size = null,
      className = '',
      showWordmark = (variant === 'full' || variant === 'sidebar' || variant === 'report'),
      alt = LOGO_CONFIG.defaultAlt,
      withBadge = (variant === 'full' || variant === 'sidebar')
    } = options;

    let sizeStyle = '';
    if (size) {
      sizeStyle = `style="width: ${typeof size === 'number' ? size + 'px' : size}; height: auto;"`;
    }

    const imgTag = `<img src="${LOGO_CONFIG.svgPath}" onerror="this.onerror=null;this.src='${LOGO_CONFIG.pngFallback}';" alt="${alt}" class="mule-shield-logo-img mule-shield-logo--${variant}" ${sizeStyle} />`;

    if (variant === 'symbol' || !showWordmark) {
      return `<div class="mule-shield-logo-wrapper mule-shield-logo--symbol ${className}" title="${alt}">${imgTag}</div>`;
    }

    if (variant === 'sidebar') {
      return `
        <div class="mule-shield-logo-component mule-shield-logo-sidebar-brand ${className}">
          <div class="mule-shield-logo-emblem-box">
            ${imgTag}
          </div>
          <div class="mule-shield-logo-meta brand-info">
            <h2 class="mule-shield-brand-title">${LOGO_CONFIG.brandName}</h2>
            ${withBadge ? `<span class="badge mule-shield-brand-badge">${LOGO_CONFIG.badgeText}</span>` : ''}
          </div>
        </div>
      `;
    }

    if (variant === 'navbar') {
      return `
        <div class="mule-shield-logo-component mule-shield-logo-navbar-brand ${className}">
          <div class="mule-shield-logo-emblem-box">
            ${imgTag}
          </div>
          ${showWordmark ? `<span class="mule-shield-navbar-title">${LOGO_CONFIG.brandName}</span>` : ''}
        </div>
      `;
    }

    if (variant === 'loading') {
      return `
        <div class="mule-shield-logo-component mule-shield-logo-loading-brand ${className}">
          <div class="mule-shield-loading-emblem-wrap">
            ${imgTag}
            <div class="mule-shield-loading-pulse-ring"></div>
          </div>
          <div class="mule-shield-loading-text">
            <div class="mule-shield-loading-title">${LOGO_CONFIG.brandName}</div>
            <div class="mule-shield-loading-sub">Multi-Agent Forensic Intelligence</div>
          </div>
        </div>
      `;
    }

    if (variant === 'report') {
      return `
        <div class="mule-shield-logo-component mule-shield-logo-report-brand ${className}">
          <div class="mule-shield-logo-emblem-box">
            ${imgTag}
          </div>
          <div class="mule-shield-report-text">
            <h2 class="mule-shield-report-title">${LOGO_CONFIG.brandName} FORENSICS</h2>
            <span class="mule-shield-report-sub">AUDITED FINANCIAL INTELLIGENCE DOSSIER</span>
          </div>
        </div>
      `;
    }

    // Default 'full' variant
    return `
      <div class="mule-shield-logo-component mule-shield-logo-full-brand ${className}">
        <div class="mule-shield-logo-emblem-box">
          ${imgTag}
        </div>
        <div class="mule-shield-logo-meta">
          <h2 class="mule-shield-brand-title">${LOGO_CONFIG.brandName}</h2>
          ${withBadge ? `<span class="badge mule-shield-brand-badge">${LOGO_CONFIG.badgeText}</span>` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Creates a DOM element representation of the MULE SHIELD logo
   * @param {Object} options Configuration options
   * @returns {HTMLElement}
   */
  function create(options = {}) {
    const temp = document.createElement('div');
    temp.innerHTML = render(options).trim();
    return temp.firstElementChild;
  }

  /**
   * Mounts the logo into a target container selector or element
   * @param {string|HTMLElement} target Container
   * @param {Object} options Configuration options
   */
  function mount(target, options = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (el) {
      el.innerHTML = render(options);
    }
  }

  /**
   * Automatically initializes all declarative logo containers
   * Usage: <div data-mule-shield-logo="sidebar"></div>
   */
  function init() {
    if (typeof document === 'undefined') return;
    const containers = document.querySelectorAll('[data-mule-shield-logo]');
    containers.forEach(container => {
      const variant = container.getAttribute('data-mule-shield-logo') || 'full';
      const sizeAttr = container.getAttribute('data-size');
      const size = sizeAttr ? parseInt(sizeAttr, 10) : null;
      const showWordmark = container.getAttribute('data-wordmark') !== 'false';
      mount(container, { variant, size, showWordmark });
    });
  }

  // Auto-run init on DOMContentLoaded if in browser
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // Component API
  return {
    render,
    create,
    mount,
    init,
    CONFIG: LOGO_CONFIG
  };
}));
