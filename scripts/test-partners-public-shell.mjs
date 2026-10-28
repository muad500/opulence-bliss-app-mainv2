import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest, NextResponse } from "next/server.js";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) =>
  readFile(new URL("../" + path, import.meta.url), "utf8");
const empty = () => null;
const link = ({ href, children, ...props }) => {
  delete props.prefetch;
  return React.createElement("a", { ...props, href }, children);
};

async function load(path, mocks = {}, globals = {}, onRequire = () => {}) {
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(await source(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    require: (id) => {
      onRequire(id);
      if (id in mocks) return mocks[id];
      if (id.endsWith(".css"))
        return new Proxy({}, { get: (_target, key) => String(key) });
      if (id === "next/link") return { __esModule: true, default: link };
      if (id.startsWith("@/") || id.startsWith("./"))
        throw Error(`Unexpected dependency during isolated render: ${id}`);
      return require(id);
    },
    process: {
      env: {
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fictional-no-access",
      },
    },
    console,
    URL,
    ...globals,
  });
  return compiledModule.exports;
}

function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

test("the Partner page renders the site's inert header without loading the account chrome", async () => {
  let path = "/partners";
  let standardRenders = 0;
  let standardLoads = 0;
  const { default: Chrome } = await load(
    "components/WebsiteChrome.tsx",
    {
      "next/navigation": { usePathname: () => path },
      "next/dynamic": {
        __esModule: true,
        default: () => (props) => {
          standardRenders++;
          return React.createElement(
            "section",
            { "data-standard": true },
            props.children,
          );
        },
      },
      "./SiteHeader": {
        __esModule: true,
        default: ({ storageFree }) =>
          React.createElement("header", { "data-storage-free": storageFree }),
      },
      "./EnvironmentBanner": {
        __esModule: true,
        default: () =>
          React.createElement(
            "aside",
            { role: "status" },
            "Environment banner",
          ),
      },
    },
    {},
    (id) => {
      if (id.endsWith("StandardWebsiteChrome")) {
        standardLoads++;
        assert.fail(
          "Partner page must not load account, service-worker or chat modules",
        );
      }
    },
  );
  const markup = renderToStaticMarkup(
    React.createElement(Chrome, null, "Approved Partner content"),
  );
  assert.match(markup, /data-storage-free="true"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /href="#main-content"/);
  assert.match(markup, /id="main-content" tabindex="-1"/);
  assert.match(markup, /Approved Partner content/);
  assert.equal(standardRenders, 0);
  assert.equal(standardLoads, 0);
  path = "/account";
  const ordinary = renderToStaticMarkup(
    React.createElement(Chrome, null, "Account content"),
  );
  assert.match(ordinary, /Account content/);
  assert.equal(
    standardRenders,
    1,
    "ordinary pages retain their existing chrome",
  );
});

test("the storage-free site header never initializes auth or prefetches another route", async () => {
  const effects = [];
  const prefetched = [];
  const menus = [];
  const hooks = {
    ...React,
    useState: (initial) => [
      typeof initial === "function" ? initial() : initial,
      () => {},
    ],
    useEffect: (effect) => effects.push(effect),
  };
  const Menu = ({ storageFree }) => {
    menus.push(storageFree);
    return React.createElement("span", null, "Site navigation");
  };
  const { default: Header } = await load("components/SiteHeader.tsx", {
    react: hooks,
    "next/navigation": { usePathname: () => "/partners" },
    "next/link": {
      __esModule: true,
      default: (props) => {
        prefetched.push(props.prefetch);
        return link(props);
      },
    },
    "@/lib/supabase/client": {
      createClient: () =>
        assert.fail("Partner header must not initialize browser auth"),
    },
    "@/components/CleaningMenu": { __esModule: true, default: Menu },
    "@/components/ComingSoonMenu": { __esModule: true, default: Menu },
    "./AccountModeSwitch": { __esModule: true, default: empty },
    "@/lib/portalUpdates": { PORTAL_REFRESH_REQUESTED: "fictional-refresh" },
    "@/lib/professionalAccess": { canUseProfessionalTools: () => false },
  });
  const markup = renderToStaticMarkup(Header({ storageFree: true }));
  for (const effect of effects) effect();
  assert.match(markup, /data-website-header/);
  assert.match(markup, /opulence/);
  assert.match(markup, /Sign in/);
  assert.ok(prefetched.length > 4);
  assert.ok(prefetched.every((value) => value === false));
  assert.ok(menus.length > 0);
  assert.ok(
    menus.every(Boolean),
    "dropdowns must use their own stateless variant too",
  );
});

test("the root presentation script leaves Partner visits' browser storage untouched", async () => {
  const { default: Layout } = await load("app/layout.tsx", {
    "next/font/google": {
      Nunito: () => ({ className: "self-hosted-font", variable: "--font" }),
    },
    "@/components/WebsiteChrome": { __esModule: true, default: empty },
    "@/components/StyleRegistry": { __esModule: true, default: empty },
  });
  const scripts = elements(Layout({ children: "Fictional page" })).filter(
    (node) => node.type === "script",
  );
  assert.equal(scripts.length, 1);
  const code = scripts[0].props.dangerouslySetInnerHTML.__html;
  let reads = 0;
  const sessionStorage = {
    getItem: () => {
      reads++;
      throw Error("Storage unavailable");
    },
    setItem: () =>
      assert.fail("The Partner page must never write browser storage"),
  };
  vm.runInNewContext(code, {
    location: { pathname: "/partners" },
    sessionStorage,
    document: { documentElement: { dataset: {} } },
  });
  assert.equal(reads, 0);
  vm.runInNewContext(code, {
    location: { pathname: "/book" },
    sessionStorage,
    document: { documentElement: { dataset: {} } },
  });
  assert.equal(
    reads,
    1,
    "the exemption must not remove ordinary app presentation restoration",
  );
});

test("Partner public routes bypass auth refresh, while worker pages retain session protection", async () => {
  let authInitializations = 0;
  const { updateSession } = await load("lib/supabase/proxy.ts", {
    "next/server": { NextResponse },
    "./sessionOptions": { supabaseSessionOptions: () => ({}) },
    "../utils": { hasEnvVars: true },
    "../professionalAccess": { canUseProfessionalTools: () => false },
    "@supabase/ssr": {
      createServerClient: () => {
        authInitializations++;
        return { auth: { getClaims: async () => ({ data: null }) } };
      },
    },
  });
  for (const path of ["/partners", "/api/partner-interest"]) {
    const response = await updateSession(
      new NextRequest("https://www.opulencebliss.com" + path, {
        headers: { cookie: "fictional-session=existing" },
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("location"), null);
  }
  assert.equal(authInitializations, 0);
  const worker = await updateSession(
    new NextRequest("https://www.opulencebliss.com/worker"),
  );
  assert.equal(authInitializations, 1);
  assert.equal(
    new URL(worker.headers.get("location")).pathname,
    "/provider/login",
  );
  await updateSession(
    new NextRequest("https://www.opulencebliss.com/partners/private"),
  );
  assert.equal(
    authInitializations,
    2,
    "the public exemption is exact, not a broad prefix",
  );
});

test("signed-out visitors can open the shared earning choices without an account", async () => {
  const { updateSession } = await load("lib/supabase/proxy.ts", {
    "next/server": { NextResponse },
    "./sessionOptions": { supabaseSessionOptions: () => ({}) },
    "../utils": { hasEnvVars: true },
    "../professionalAccess": { canUseProfessionalTools: () => false },
    "@supabase/ssr": {
      createServerClient: () => ({
        auth: { getClaims: async () => ({ data: null }) },
      }),
    },
  });
  const response = await updateSession(
    new NextRequest("https://www.opulencebliss.com/earn-with-us"),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
});

test("the Partner footer omits the live review query and keeps all navigation unprefetched", async () => {
  const prefetched = [];
  const legal = await load("lib/legal.ts");
  const { default: Footer } = await load("components/SiteFooter.tsx", {
    "@/lib/legal": legal,
    "next/link": {
      __esModule: true,
      default: (props) => {
        prefetched.push(props.prefetch);
        return link(props);
      },
    },
    "./FooterReviews": {
      __esModule: true,
      default: () => assert.fail("Partner footer must not mount live reviews"),
    },
    "./SocialLinks": {
      __esModule: true,
      default: ({ staticOnly }) => {
        assert.equal(staticOnly, true);
        return React.createElement("nav", { "aria-label": "Social pages" });
      },
    },
  });
  const markup = renderToStaticMarkup(
    React.createElement(Footer, { storageFree: true }),
  );
  assert.match(markup, /data-website-footer/);
  assert.match(markup, /Become a Partner/);
  assert.match(markup, /href="\/legal\/privacy"/);
  assert.match(markup, /href="\/legal\/terms"/);
  assert.ok(prefetched.length > 10);
  assert.ok(prefetched.every((value) => value === false));
});

test("static social links never request account-backed settings", async () => {
  const effects = [];
  const hooks = {
    ...React,
    useState: (initial) => [initial, () => {}],
    useEffect: (effect) => effects.push(effect),
  };
  const social = await load("lib/socialLinks.ts");
  const { default: SocialLinks } = await load(
    "components/SocialLinks.tsx",
    { react: hooks, "@/lib/socialLinks": social },
    {
      fetch: () => assert.fail("Static social links must never fetch settings"),
    },
  );
  const markup = renderToStaticMarkup(
    SocialLinks({ staticOnly: true, variant: "footer" }),
  );
  for (const effect of effects) effect();
  assert.match(markup, /Opulence Bliss social pages/);
  assert.match(markup, /Facebook/);
});

test("opened storage-free navigation menus never load packages or account polls", async () => {
  const effects = [];
  const prefetched = [];
  const hooks = {
    ...React,
    useState: (initial) => [initial === false ? true : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect: (effect) => effects.push(effect),
  };
  const passThrough = ({ children }) =>
    React.createElement(React.Fragment, null, children);
  const shared = {
    react: hooks,
    "next/navigation": { usePathname: () => "/partners" },
    "next/link": {
      __esModule: true,
      default: (props) => {
        prefetched.push(props.prefetch);
        return link(props);
      },
    },
    "@/components/ui/dropdown-menu": {
      DropdownMenu: passThrough,
      DropdownMenuContent: passThrough,
      DropdownMenuItem: passThrough,
      DropdownMenuTrigger: passThrough,
    },
  };
  const { default: CleaningMenu } = await load("components/CleaningMenu.tsx", {
    ...shared,
    "@/lib/supabase/client": {
      createClient: () =>
        assert.fail("Partner menu must not query packages or initialize auth"),
    },
    "@/lib/cleaningBooking": {
      CLEANING_SESSION_ORDER: ["Essential Clean", "Signature Deep Clean"],
    },
  });
  const { default: ComingSoonMenu } = await load(
    "components/ComingSoonMenu.tsx",
    {
      ...shared,
      "@/lib/comingSoon": {
        COMING_SOON: [{ key: "test", title: "Future service" }],
      },
      "@/components/ServicePoll": {
        __esModule: true,
        default: () =>
          assert.fail("Partner menu must not mount account-backed polls"),
      },
    },
  );
  const cleaning = renderToStaticMarkup(CleaningMenu({ storageFree: true }));
  const future = renderToStaticMarkup(ComingSoonMenu({ storageFree: true }));
  for (const effect of effects) effect();
  assert.match(cleaning, /Essential Clean/);
  assert.match(future, /Future service/);
  assert.ok(prefetched.length > 4);
  assert.ok(prefetched.every((value) => value === false));
});

test("the public route exemption cannot put a Partner page or signup API on the staff host", async () => {
  const hosts = await load("lib/adminHosts.ts");
  const { proxy } = await load("proxy.ts", {
    "next/server": { NextResponse },
    "@/lib/adminHosts": hosts,
    "@/lib/handymanMarketplace": {
      handymanEnabled: () => false,
      isHandymanMarketplacePath: () => false,
    },
    "@/lib/supabase/proxy": {
      updateSession: () =>
        assert.fail("Host routing must run before session handling"),
    },
  });
  for (const path of ["/partners", "/api/partner-interest"]) {
    const response = await proxy(
      new NextRequest("https://admin.opulencebliss.com" + path),
    );
    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      "https://www.opulencebliss.com" + path,
    );
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("Earn with us presents both independent choices with working local destinations", async () => {
  const { default: Page } = await load("app/earn-with-us/page.tsx", {
    "@/components/SiteFooter": { __esModule: true, default: empty },
  });
  const markup = renderToStaticMarkup(React.createElement(Page));
  assert.match(
    markup,
    /href="\/provider\/join"[^>]*>Work with us as a cleaner/,
  );
  assert.match(markup, /href="\/partners"[^>]*>Become a Partner/);
  assert.match(markup, /<h1[^>]*>Earn with us<\/h1>/);
});

test("client and professional portal menus link Earn with us to the shared choice page", async () => {
  const { default: Portal } = await load("components/PortalNavigation.tsx", {
    "next/navigation": { usePathname: () => "/account" },
    "@/lib/supabase/client": { createClient: () => ({}) },
    "./AccountModeSwitch": { __esModule: true, default: empty },
  });
  for (const mode of ["client", "professional"]) {
    const markup = renderToStaticMarkup(
      React.createElement(Portal, {
        mode,
        name: "Fictional person",
        approved: true,
        registered: true,
      }),
    );
    const earnLinks = (markup.match(/<a\b[^>]*>/g) || []).filter(
      (tag) =>
        tag.includes('href="/earn-with-us"') &&
        tag.includes('data-earn-with-us="true"'),
    );
    assert.ok(earnLinks.length > 0, mode);
    assert.doesNotMatch(
      markup,
      /<a[^>]*href="\/provider\/join"[^>]*data-earn-with-us/,
    );
  }
});

test("mobile customer and worker menus offer the shared earning choices", async () => {
  const db = {
    auth: {
      getUser: async () => ({
        data: {
          user: { id: "fictional-person", email: "person@example.test" },
        },
      }),
    },
    from: () => {
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({
          data: { full_name: "Fictional person", email: "person@example.test" },
        }),
      };
      return query;
    },
  };
  const { default: MobileMenu } = await load(
    "app/mobile/[audience]/account/page.tsx",
    {
      "next/navigation": {
        notFound: () => assert.fail("A valid audience must load"),
      },
      "@/lib/supabase/server": { createClient: async () => db },
      "@/lib/professionalAccess": { canUseProfessionalTools: () => true },
    },
  );
  for (const audience of ["customer", "worker"]) {
    const markup = renderToStaticMarkup(
      await MobileMenu({ params: Promise.resolve({ audience }) }),
    );
    const earnLinks = (markup.match(/<a\b[^>]*>/g) || []).filter(
      (tag) =>
        tag.includes('href="/earn-with-us"') &&
        tag.includes('data-earn-with-us="true"'),
    );
    assert.equal(earnLinks.length, 1);
    assert.match(markup, /Explore cleaning work or become a Partner/);
  }
});

test("the homepage and booking earning links do not send people straight to cleaner signup", async () => {
  const { default: Home } = await load("app/page.tsx", {
    "next/image": {
      __esModule: true,
      default: (imageProps) => {
        const props = { ...imageProps };
        delete props.priority;
        delete props.fill;
        return React.createElement("img", props);
      },
    },
    "@/lib/supabase/client": {
      createClient: () =>
        assert.fail("Effects must not run during server render"),
    },
    "@/components/SiteFooter": { __esModule: true, default: empty },
  });
  const markup = renderToStaticMarkup(React.createElement(Home));
  assert.match(markup, /href="\/earn-with-us"[^>]*>Earn with Us<\/a>/);
  assert.match(markup, /href="\/partners">Become a Partner<\/a>/);
  const booking = ts.createSourceFile(
    "book.tsx",
    await source("app/book/page.tsx"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let actualEarnDestination;
  function visit(node) {
    if (
      ts.isJsxElement(node) &&
      node.children.some(
        (child) => ts.isJsxText(child) && child.text.includes("Earn with us"),
      )
    ) {
      const href = node.openingElement.attributes.properties.find(
        (property) =>
          ts.isJsxAttribute(property) && property.name.text === "href",
      );
      actualEarnDestination = href?.initializer?.text;
    }
    ts.forEachChild(node, visit);
  }
  visit(booking);
  assert.equal(actualEarnDestination, "/earn-with-us");
});
