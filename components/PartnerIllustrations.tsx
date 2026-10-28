/** Replace these three illustrations here when the approved photographs arrive. */
export default function PartnerIllustration({ kind }: { kind: 0 | 1 | 2 }) {
  return [
    <svg
      key={0}
      className="art"
      viewBox="0 0 520 380"
      role="img"
      aria-label="Illustration of a house and a phone showing a recommendation message"
    >
      <defs>
        <linearGradient id={"partner-metal-0"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b48a2f" />
          <stop offset=".38" stopColor="#f2e1ab" />
          <stop offset=".62" stopColor="#c9a24d" />
          <stop offset="1" stopColor="#ecd79f" />
        </linearGradient>
      </defs>
      <circle className="t" cx="270" cy="200" r="160" />
      <rect className="h" x="170" y="170" width="200" height="150" rx="10" />
      <polygon className="a" points="150,180 270,80 390,180" />
      <rect className="s" x="330" y="96" width="26" height="52" rx="3" />
      <rect className="w" x="195" y="205" width="52" height="52" rx="6" />
      <path
        className="ln"
        d="M221 205v52M195 231h52"
        style={{ stroke: "var(--shade)", strokeWidth: "3" }}
      />
      <rect
        className="m"
        fill="url(#partner-metal-0)"
        x="283"
        y="226"
        width="64"
        height="94"
        rx="6"
      />
      <circle className="h" cx="337" cy="274" r="4" />
      <rect
        className="s"
        x="120"
        y="150"
        width="130"
        height="190"
        rx="22"
        style={{ fill: "var(--hero)" }}
      />
      <rect className="w" x="130" y="168" width="110" height="154" rx="12" />
      <rect className="a" x="140" y="182" width="74" height="30" rx="14" />
      <rect className="t" x="156" y="222" width="74" height="30" rx="14" />
      <rect className="a" x="140" y="262" width="60" height="22" rx="11" />
      <circle
        className="m"
        fill="url(#partner-metal-0)"
        cx="224"
        cy="297"
        r="12"
      />
      <path
        className="m"
        fill="url(#partner-metal-0)"
        d="M420 104 Q420 120 436 120 Q420 120 420 136 Q420 120 404 120 Q420 120 420 104Z"
      />
      <path
        className="m"
        fill="url(#partner-metal-0)"
        d="M100 98 Q100 110 112 110 Q100 110 100 122 Q100 110 88 110 Q100 110 100 98Z"
      />
      <path
        className="m"
        fill="url(#partner-metal-0)"
        d="M440 290 Q440 300 450 300 Q440 300 440 310 Q440 300 430 300 Q440 300 440 290Z"
      />
    </svg>,
    <svg
      key={1}
      className="art"
      viewBox="0 0 520 380"
      role="img"
      aria-label="Illustration of a cleaner arriving at a front door with a bucket and a checked shield"
    >
      <defs>
        <linearGradient id={"partner-metal-1"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b48a2f" />
          <stop offset=".38" stopColor="#f2e1ab" />
          <stop offset=".62" stopColor="#c9a24d" />
          <stop offset="1" stopColor="#ecd79f" />
        </linearGradient>
      </defs>
      <circle className="t" cx="260" cy="210" r="160" />
      <rect className="h" x="300" y="70" width="140" height="250" rx="10" />
      <rect className="a" x="316" y="86" width="108" height="234" rx="6" />
      <circle
        className="m"
        fill="url(#partner-metal-1)"
        cx="408"
        cy="205"
        r="7"
      />
      <rect className="t" x="338" y="104" width="64" height="62" rx="6" />
      <rect className="w" x="60" y="318" width="400" height="10" rx="5" />
      <circle className="h" cx="180" cy="150" r="30" />
      <path className="h" d="M135 322 Q135 205 180 205 Q225 205 225 322Z" />
      <path className="a" d="M152 215 Q180 245 208 215 L216 322 H144Z" />
      <rect
        className="m"
        fill="url(#partner-metal-1)"
        x="228"
        y="276"
        width="46"
        height="44"
        rx="8"
      />
      <path
        className="ln"
        d="M232 276 Q251 246 270 276"
        style={{ stroke: "var(--hero)" }}
      />
      <path
        className="m"
        fill="url(#partner-metal-1)"
        d="M96 120 L130 108 L164 120 V150 Q164 176 130 190 Q96 176 96 150Z"
        transform="translate(-20 -20)"
      />
      <path
        className="ln"
        d="M94 128 l14 14 l26 -28"
        style={{ stroke: "#fff", strokeWidth: "6" }}
      />
      <path
        className="m"
        fill="url(#partner-metal-1)"
        d="M450 46 Q450 60 464 60 Q450 60 450 74 Q450 60 436 60 Q450 60 450 46Z"
      />
      <path
        className="m"
        fill="url(#partner-metal-1)"
        d="M70 240 Q70 250 80 250 Q70 250 70 260 Q70 250 60 250 Q70 250 70 240Z"
      />
    </svg>,
    <svg
      key={2}
      className="art"
      viewBox="0 0 520 340"
      role="img"
      aria-label="Illustration of three gift cards with a ribbon"
    >
      <defs>
        <linearGradient id={"partner-metal-2"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b48a2f" />
          <stop offset=".38" stopColor="#f2e1ab" />
          <stop offset=".62" stopColor="#c9a24d" />
          <stop offset="1" stopColor="#ecd79f" />
        </linearGradient>
      </defs>
      <circle className="t" cx="260" cy="180" r="150" />
      <g transform="rotate(-12 260 200)">
        <rect className="s" x="110" y="110" width="270" height="168" rx="18" />
      </g>
      <g transform="rotate(7 260 200)">
        <rect className="a" x="140" y="96" width="270" height="168" rx="18" />
        <rect
          className="m"
          fill="url(#partner-metal-2)"
          x="170"
          y="130"
          width="64"
          height="44"
          rx="8"
        />
        <rect
          className="w"
          x="170"
          y="200"
          width="150"
          height="12"
          rx="6"
          style={{ opacity: ".85" }}
        />
        <rect
          className="w"
          x="170"
          y="226"
          width="96"
          height="12"
          rx="6"
          style={{ opacity: ".6" }}
        />
      </g>
      <g>
        <rect className="h" x="170" y="170" width="270" height="140" rx="18" />
        <rect
          className="m"
          fill="url(#partner-metal-2)"
          x="292"
          y="170"
          width="26"
          height="140"
        />
        <path
          className="m"
          fill="url(#partner-metal-2)"
          d="M305 170 C260 120 230 150 305 170 C380 150 350 120 305 170Z"
        />
        <rect
          className="w"
          x="190"
          y="196"
          width="80"
          height="10"
          rx="5"
          style={{ opacity: ".75" }}
        />
      </g>
      <path
        className="m"
        fill="url(#partner-metal-2)"
        d="M80 76 Q80 90 94 90 Q80 90 80 104 Q80 90 66 90 Q80 90 80 76Z"
      />
      <path
        className="m"
        fill="url(#partner-metal-2)"
        d="M470 98 Q470 110 482 110 Q470 110 470 122 Q470 110 458 110 Q470 110 470 98Z"
      />
      <path
        className="m"
        fill="url(#partner-metal-2)"
        d="M440 290 Q440 300 450 300 Q440 300 440 310 Q440 300 430 300 Q440 300 440 290Z"
      />
    </svg>,
  ][kind];
}
