---
title: "The Pricing Convention Was Bigger Than the Market"
subtitle: "Building SPY's local volatility surface, and what flat vol costs on a barrier option"
date: 2026-08-13
tags: [quantitative-finance, local-volatility, dupire, exotic-options, pde, monte-carlo, python]
summary: >
  Three defensible flat-volatility conventions price the same one-year
  down-and-out call at 56.35, 57.57 and 61.05. Bid-offer is 20–40bp of spot.
  Building the Dupire surface the market actually implies, and measuring the
  gap.
demo: https://codeebytee.github.io/04-local-vol-dupire/
repo: https://github.com/codeebytee/04-local-vol-dupire
---

# The Pricing Convention Was Bigger Than the Market

An exotics desk gets asked for a price on a one-year down-and-out call on SPY:
struck at spot, barrier 10% below, knocked out if the index ever trades there.

Black–Scholes takes one volatility. The market quotes a surface — one-year
10%-OTM puts trading around 21.5 vol against 17.3 at the money. So the first
question is operational, not academic: **which vol?**

ATM is the default. Some traders use the vol at the strike. Others use the vol
at the barrier, on the argument that the barrier is what the option is really a
bet on. All three are defensible. Here's what they give, on a contract worth
about 54:

| Convention | Price |
|---|---|
| Flat vol @ ATM (17.25%) | 56.35 |
| Flat vol @ strike (18.20%) | 57.57 |
| Flat vol @ barrier (21.48%) | 61.05 |

The spread between them is **470 basis points of spot**. Bid-offer on this
contract is perhaps 20–40bp. The choice of convention is an order of magnitude
larger than the market it's quoting into, which means no flat-vol answer is
defensible and the desk needs a model that reprices the whole surface at once.

Local volatility is the minimal such model. This project builds it from a real
SPY chain, prices the contract under it two independent ways, and puts a number
on what the shortcut costs.

---

## The headline

One-year down-and-out call, K = S = 771.33, H = 0.90S = 694.20, continuous
monitoring, r = 4.20%, q = 1.05%, chain as of 2026-08-05:

| Method | Price | vs local vol |
|---|---|---|
| **Local volatility (Crank–Nicolson PDE)** | **53.897** | — |
| Local volatility (Monte Carlo, 200k paths, Brownian bridge) | 53.943 ± 0.130 | +0.35 se |
| Flat vol @ ATM — the usual shortcut | 56.351 | **−31.8 bp of spot (−4.36%)** |
| Flat vol @ strike | 57.570 | −47.6 bp (−6.38%) |
| Flat vol @ barrier | 61.049 | −92.7 bp (−11.72%) |
| Vanilla call, same strike, ATM vol | 67.151 | — |

**Every flat-vol convention overprices this contract**, by between 32 and 93
basis points of spot, against a bid-offer of 20–40.

The sign has a clean reading. Negative skew means volatility rises as spot
falls. Paths heading toward a down-barrier are therefore more volatile than a
flat-ATM pricer assumes, they knock out more often, and the option is worth
less. A trader quoting down-and-outs off ATM vol is systematically paying too
much — and, running the same argument backwards, selling down-and-ins too cheap.

And which convention is worst depends on where the barrier sits. The error
against flat-ATM is non-monotone: it peaks near H ≈ 0.875–0.90 at about −33bp
and closes at both ends, because a deep barrier barely bites and a near barrier
leaves little value either way. The error against vol-read-at-the-barrier grows
without bound as the barrier deepens — about −390bp at H = 0.70 — since that
convention reads the vol further and further out on a steep smile. **The popular
shortcut is worst exactly where it feels most natural to reach for it.**

---

## Dupire, and the identity that makes it make sense

Dupire (1994) showed that an arbitrage-free surface of European call prices is
reproduced by exactly one one-factor diffusion:

$$\sigma_{LV}^2(K,T)=\frac{\partial_T C + (r-q)K\,\partial_K C + qC}{\tfrac12 K^2 \partial^2_{KK}C}$$

That is the equation everybody writes down and almost nobody should implement
(more on why below). Rewrite it in the coordinates the market actually quotes —
total implied variance $w(k,T)=\sigma_{BS}^2 T$ at forward log-moneyness $k$ —
and you get Gatheral's form, whose denominator turns out to be *identically*
Durrleman's function:

$$g(k)=\Big(1-\frac{k w_k}{2w}\Big)^{2}-\frac{w_k^2}{4}\Big(\frac1w+\frac14\Big)+\frac{w_{kk}}{2}$$

whose non-negativity is exactly the no-butterfly-arbitrage condition on the
slice. So Dupire reads:

$$\sigma_{LV}^2=\frac{\partial_T w}{g(k)}$$

**A numerator that is non-negative precisely when there is no calendar
arbitrage, over a denominator that is non-negative precisely when there is no
butterfly arbitrage.**

This reframes the whole thing. Local volatility is not a delicate object that
mysteriously misbehaves. It is well defined *if and only if* the implied surface
it was built from is arbitrage-free, and it fails exactly where that surface is
bad. Every "my local vol blew up" report is a report about the input surface.

The code is written so the diagnosis is always available: the Dupire routine
returns numerator and denominator **separately**, never just their ratio, and
the interface plots g(k) next to every surface. The identity is load-bearing, so
it's tested rather than asserted — a test checks Gatheral's denominator equals
Durrleman's g to relative machine precision on 200 random draws.

## Fitting worse on purpose

If the input surface is what determines whether local vol exists, the fit
becomes the central design decision. And the right choice is counterintuitive.

Per-slice SVI fits the 1,436 surviving quotes to **1.25 vol points** with 45 free
parameters. SSVI — three global parameters plus a 9-knot ATM variance curve, 12
in total — manages only **3.86**. SSVI wins anyway:

| | per-slice SVI | SSVI |
|---|---|---|
| free parameters | 45 | 12 |
| fit RMSE | 1.25 vol pts | 3.86 vol pts |
| calendar-arbitrage free | ✗ | ✓ |
| butterfly-arbitrage free | ✗ | ✓ |
| local vol defined everywhere | ✗ | ✓ (0 of 6,305 grid points invalid) |

The raw chain contains **649 butterfly violations and 2 calendar violations**
before any fitting. A closer fit to data that contains arbitrage inherits the
arbitrage and hands Dupire a denominator that crosses zero. Fitting the noise
more faithfully makes the downstream model *not exist*.

### Can smoothing rescue a raw surface? No.

This was the part I expected to go the other way. Nine smoothing parameters,
each refitting every slice with a cubic smoothing spline and rebuilding local
vol from that:

| λ | fit RMSE | butterfly g≤0 | calendar w_T≤0 | **undefined** | ATM LV skew |
|---|---|---|---|---|---|
| 1e-9 | 0.31 | 31.9% | 9.5% | **40.4%** | +0.155 |
| 1e-7 | 0.39 | 20.7% | 5.5% | **26.3%** | +1.047 |
| 1e-5 | 1.06 | 1.0% | 1.1% | **2.1%** | −0.463 |
| 1e-4 | 2.14 | 0.0% | 3.4% | **3.4%** | −0.251 |
| 1e-2 | 5.67 | 0.0% | 6.6% | **6.6%** | −0.326 |
| 1e-1 | 7.18 | 0.0% | 9.2% | **9.2%** | −0.321 |

Read the middle two columns together. As λ rises, butterfly violations go to
zero and calendar violations *rise* — the smoother trades one arbitrage for
another, because a per-slice spline knows nothing about the slice next door. The
undefined fraction bottoms out at **2.1% and never reaches zero** across five
orders of magnitude.

The skew column is the second finding. At λ = 1e-7 the fitted ATM local vol skew
is **+1.05** — the wrong *sign* for an equity index — because spline wiggle at
that scale dominates the genuine slope. The surface that looks best by fit error
produces a smile that does not exist.

Regularisation controls variance. It does not impose no-arbitrage. That's the
argument for building from an arbitrage-free parameterisation instead.

---

## Numerics: the details that decide whether the number is real

**The call-price form is implemented in order to fail honestly.** Equation (1)
requires $\partial^2_{KK}C$, the discounted density. At the one-year wings of
this surface that's $O(10^{-5})$ per dollar-squared while C is $O(10^{-2})$, so
a relative error of $10^{-6}$ in the price grid — an order of magnitude below
one tick — is a relative error of order **one** in the denominator. Tested on a
purely analytic surface with no market noise anywhere: 3.5% of grid points
discarded, 2.20 vol points RMSE in the wings, worst point off by 60.8. The
implied-vol form on the same surface is exact to floating point, because it
never differentiates a price.

**A first-order stencil at a boundary looks exactly like a broken model.** The
maturity derivative was originally central inside the grid and a two-point
one-sided difference at the first and last maturity. That's O(h) at precisely
the rows a front-month barrier prices off: it put the first row **4.7 vol
points** from the analytic answer while every interior row was inside 0.4.
Replacing it with a three-point Lagrange derivative (written for non-uniform
grids, because listed expiries are never equally spaced) removed it.

**Three PDE choices, each buying something specific.** Log-spot coordinates turn
the $\tfrac12\sigma^2S^2\partial_{SS}$ operator into a constant-coefficient
Laplacian, so the tridiagonal system stays well conditioned when local vol
ranges from 0.11 to 1.24 across the grid. A **Rannacher start** — two fully
implicit half-steps before Crank–Nicolson begins — kills the classic gamma
sawtooth, since pure CN is A-stable but not L-stable and damps the highest grid
mode excited by the kinked payoff by a factor tending to −1. And the **barrier
sits on a grid node**: if it falls between nodes the Dirichlet condition is
applied at the wrong place and the scheme silently degrades to first order. The
grid builder adjusts n so both log S₀ and log H are exact nodes. Measured
convergence order: **1.96** against a theoretical 2.

**The Monte Carlo bias that isn't sampling error.** Between two simulated points
the probability that the Brownian bridge maximum crossed the barrier is known in
closed form, so each step contributes a survival probability rather than a 0/1
indicator. Without it, a 52-step simulation misses crossings between observation
dates and overprices a knock-out by an $O(\sqrt{\Delta t})$ amount — a bias, not
noise, which no number of paths removes. Measured at 52 steps: bridge +0.115,
raw **+2.531**, meaning the raw estimator is **15.7 standard errors wrong while
reporting a perfectly respectable ±0.16 error bar.** Even at 504 steps it's
still 5.0 se out. The bridge is inside one se from 13 steps upward.

(Related: antithetic pairs get averaged *before* the standard error is computed.
Treating 2n correlated draws as 2n independent ones is the standard way to
publish a confidence interval that is √2 too narrow.)

**Broken points stay visibly broken.** Where local vol is undefined the code
returns `NaN` and counts it, rather than clipping it into a plausible number. A
floored local vol reaches a PDE solver silently; a hole is a diagnosis.

### Validation

| Check | Result |
|---|---|
| Flat surface in ⟹ flat surface out | exact to machine precision (7,381 points) |
| Forward-PDE round trip: IV → local vol → prices → IV | **6.98 bp** of vol RMSE |
| PDE and MC vs Reiner–Rubinstein closed form | PDE within 0.05 bp of spot; MC within 1.2 se |
| PDE vs MC on the real surface (no closed form) | 0.35 se apart |
| PDE convergence order | 1.96 (theory: 2) |
| Browser JS vs Python library | local variance 2.8e-15; barrier PDE 6.0e-6 relative |

The round trip is the strongest of these — it closes the loop IV → local vol →
PDE → prices → IV, so a sign error or a misplaced drift term anywhere in the
chain surfaces as vol points. Seven basis points is the discretisation error of
the forward solve, not a modelling gap.

---

## Two more results worth having

**Local vol is about twice the skew of the implied vol it came from.** Measured
ATM skew ratios: 2.01× at 3 months, 2.13× at 9 months, 2.05× at 18 months — the
textbook rule of thumb, reproduced from a real chain. The mechanism: implied vol
at strike K is roughly an average of local vol along paths finishing at K, and
averaging flattens, so undoing the average steepens by about a factor of two
near the money. Concretely, a barrier at 90% of spot sits at k ≈ −0.105, where
the implied surface says 21.5 vol and the local surface says roughly 30. Those
are exactly the paths a knock-out cares about.

**Discrete monitoring is worth half the smile effect.** Real barrier contracts
monitor daily, not continuously. Broadie–Glasserman–Kou: a barrier monitored m
times per year prices like a continuous barrier at
$H\exp(\mp\beta\sigma\sqrt{\Delta t})$ with β ≈ 0.5826. For this contract that's
an effective barrier of 689.82 against a contractual 694.20 — a shift of −56.8
bp of spot, worth **+15.0 bp** on the price.

So the two corrections a flat-vol continuous-monitoring price is missing are
−31.8bp (smile) and +15.0bp (monitoring). They partly cancel. They do not cancel
out, and each is larger than the bid-offer. Getting one right while ignoring the
other is a common and expensive half-measure.

---

## What local vol is not

Worth stating plainly, because the model gets used past its warrant:

- **The forward smile is wrong by construction.** Local vol matches every
  vanilla today and implies tomorrow's smile flattens far faster than observed
  smiles do. For a single-barrier option — a bet on the terminal distribution
  plus a first-passage time — that matters much less than the skew does, which
  is why local vol survives on desks for this contract. For cliquets or
  forward-starting options, don't use it; use stochastic local vol.
- **Delta and vega are model artefacts.** Under local vol the surface is frozen
  in spot: a spot move slides the whole smile, which is not how equity smiles
  behave (they're closer to sticky-strike over short horizons). The price is the
  defensible output; the Greeks less so.
- **The wings are extrapolation, not fit.** The grid runs to k ∈ [−1.1, 0.8]
  while quotes reach roughly |k| < 0.6. Beyond that it's SSVI's own linear
  asymptotic — an assumption. Nothing about a barrier at 90% depends on it; a
  deep-barrier price does.
- **One snapshot, delayed quotes.** Everything here is a single 2026-08-05
  chain. This project makes no claim about calibration stability through time.

If I were running this in production I'd monitor three things daily: the
fraction of grid points where g ≤ 0 (should be zero, and it's a leading
indicator of a bad chain), the round-trip RMSE in vol points (should stay under
~10bp; a jump means the fit or the solver moved), and the PDE-vs-MC gap in
standard errors (should stay inside ±3).

---

**Interactive version** — drag the skew and the entire local vol surface rebuilds
in your browser; drag the barrier and a 241 × 200 Crank–Nicolson PDE re-solves.
There's a "break it" preset that pushes the input surface until local vol stops
existing, and shows you where.
<https://codeebytee.github.io/04-local-vol-dupire/>

**Code, 27 tests, and the full write-up:**
<https://github.com/codeebytee/04-local-vol-dupire>

Every number regenerates with `python scripts/make_results.py` against a
committed chain snapshot — no network call required.

### References

Dupire (1994), "Pricing with a Smile," *Risk* 7(1).
Derman & Kani (1994), "Riding on a Smile," *Risk* 7(2).
Gatheral (2006), *The Volatility Surface*, Wiley, ch. 1–2 and 5.
Gatheral & Jacquier (2014), "Arbitrage-free SVI volatility surfaces," *Quantitative Finance* 14(1).
Durrleman (2010), "From implied to spot volatilities," *Finance and Stochastics* 14(2).
Reiner & Rubinstein (1991), "Breaking Down the Barriers," *Risk* 4(8).
Broadie, Glasserman & Kou (1997), "A Continuity Correction for Discrete Barrier Options," *Mathematical Finance* 7(4).
Rannacher (1984), "Finite element solution of diffusion problems with irregular data," *Numerische Mathematik* 43.
