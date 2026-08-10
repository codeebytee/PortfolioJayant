# Fitting an arbitrage-free volatility surface (and paying for it)

I set out to build one function: `σ(K, T)`. Give it a strike and a maturity, get back an implied volatility. That's it. It sounds like an interpolation problem, and for about a day I treated it like one. It isn't.

This is a write-up of what I built, why the obvious approach fails, and the number I didn't expect at the end: making the surface arbitrage-free costs 2.6 volatility points of fit quality. Not zero, not negligible. Two and a half vol points, on real SPY data, measured rather than hand-waved.

## Why anyone needs this

An options exchange lists a lattice. SPY on the day I pulled it had 3,201 contracts across nine expiries, a grid of strikes and a handful of dates with nothing in between. Most of those contracts are junk: penny bids, hundred-percent spreads, prints from three days ago.

But almost everything a desk does downstream needs a continuous surface rather than a lattice. Pricing a barrier option means knowing the vol at a strike nobody listed. Dupire's formula, which gives you local volatility, differentiates the surface twice, and you cannot differentiate a scatter plot. Positions sit between listed strikes and still need a mark. Every greek is a derivative of something you read off the surface.

So you interpolate. And here is where it goes wrong.

A surface has a requirement the raw quotes do not: it must not admit static arbitrage. Two conditions, roughly. Within one expiry, call prices must be convex in strike (the butterfly condition). If they aren't, the implied probability density goes negative somewhere. Negative probability. Across expiries, at fixed moneyness, total variance must not fall as maturity rises (the calendar condition). If it does, you have built a calendar spread with a negative price.

Violate either and Dupire's local variance goes negative, every Monte Carlo built on the surface blows up, and the risk numbers are fiction. The dangerous part is that a surface which fits the market beautifully and admits arbitrage is worse than an obviously bad one, because people will trust it.

The raw SPY chain I pulled contains 649 negative-cost butterflies. That is not free money, and I'll come back to why, but it tells you what you inherit if you just spline through the quotes.

## Getting to clean data

Before any model, the quotes have to become implied vols, and that is more work than it looks.

**The forward is measured, not assumed.** The textbook move is `F = S·e^(r-q)T`: pick a rate, pick a dividend yield, done. I don't do that, because it's wrong by a few tenths of a percent on an index ETF and the error doesn't land where you'd hope. It lands entirely in the skew. A forward that's off by 0.3% looks exactly like a tilted smile, and you would then fit ρ to your own bad guess. Worse, the error differs by expiry, so it manufactures calendar arbitrage out of nothing.

Instead: for every strike quoted on both sides, `C(K) - P(K) = D(F - K)` is a straight line in K. Regress the difference on strike near the money. The slope gives you the discount factor, the intercept gives you the forward. The R² of that regression doubles as a staleness alarm, and it runs 0.94 to 0.9997 across the nine expiries here.

**Then filter.** Seven stages, each with a stated reason. Drop mids at or below two cents (one tick, pure rounding). Drop spreads above 60%, where the mid is a guess. Drop anything outside `|log(K/F)| > 1.2`. Keep only the out-of-the-money side, which carries the same information with better conditioning. Enforce the static price bounds, drop stale prints, drop anything that won't invert. 3,201 contracts in, 1,436 out. The funnel is written to a CSV per expiry so you can see exactly where each contract died.

**Then invert.** This is the part I underestimated. The naive inverter, Newton from σ = 0.2, diverges in the wings, where vega is around 1e-8 and the option is worth four cents. Two fixes made it robust.

First, collapse every quote to one monotone scalar problem. There is a reflection: a put at log-moneyness `-k` is the same problem as a call at `+k`. So every quote becomes a call at `κ = |k|`, and `c(κ, ·)` is strictly increasing in total variance from 0 to 1. A bracket always exists, and bisection cannot fail.

Second, start close. There's a branch point at `s = √(2κ)` where the price stops being convex in `√w`. Below it I invert the deep-wing asymptotic by fixed-point iteration in log space; above it there's a closed form that happens to be exact at the money. Three Newton steps follow, taken on `log c` rather than `c`, because the price is violently convex over that band while its log is nearly linear. Brent finishes on a ±10% bracket. Median cost is 7 Brent steps against roughly 50 for naive bisection, at about 150 µs a quote.

One numerical detail cost me an afternoon and is worth stating plainly: never route an out-of-the-money put through put-call parity. For a far OTM put, `C` and `D(F-K)` agree to fifteen digits, and their difference *is* the entire option value. You subtract two nearly identical large numbers and hand the result to an inverter. Before I fixed it, a round trip at `k = -1.0, σ = 20%` came back 0.199966, an error of 3.4e-5 on something that should round-trip to 1e-12. Reflect instead of subtract and it's exact to 1e-13.

## Two models, fought head to head

### Raw SVI, per slice

Gatheral's raw SVI describes one expiry with five numbers:

```
w(k) = a + b [ ρ(k − m) + √((k − m)² + σ²) ]
```

Level, wing slope, rotation, translation, curvature. Nine expiries at five parameters each is 45 free parameters.

Fitting all five jointly is badly conditioned. `a`, `b` and `σ` trade off against each other almost exactly, so a gradient method from a poor start lands in a different local minimum for every slice, and the surface then jumps around in maturity for no economic reason. The Zeliade trick removes three dimensions from the search: fix `(m, σ)`, substitute `y = (k-m)/σ`, and the model becomes linear in the remaining three parameters. The inner problem is then a convex program solved to its global optimum every time, and only a two-dimensional outer search is left. Same objective, no local-minimum lottery, bit-for-bit reproducible fits.

Small thing with a real payoff. The usual positivity shortcut is `a ≥ 0`, but the actual minimum of the slice is `a + bσ√(1-ρ²)`. Using the correct, looser condition mattered: the `a ≥ 0` constraint was binding on six of nine slices, and relaxing it cut the error from 1.73 to 1.25 vol points.

### SSVI, globally

SSVI parameterises the whole surface with three shape parameters plus one ATM variance per maturity, so 12 here instead of 45. Every SSVI slice is still a raw SVI slice under an exact map (verified to 1e-13 in the tests), so nothing is lost in kind, only in count.

The reason to bother is Gatheral and Jacquier's theorems. With a power-law `φ(θ) = ηθ^(-γ)` and the parameters kept inside stated bounds, the surface is calendar-free and butterfly-free by construction. Not checked afterwards, not repaired afterwards. I also make monotonicity unreachable rather than constrained: the optimiser works in `θ₁ = e^(z₀)` and `θ_(i+1) = θ_i + e^(z_i)`, so a decreasing ATM variance term structure isn't a violation the solver has to avoid, it's a state it cannot represent.

That is the design choice the whole project turns on. The easy alternative is to fit freely and then project the result onto the admissible set. It's less code, and it gives you no guarantee whatsoever about the region between your knots, which is precisely where an exotic will price.

## The result

Nine SPY expiries, 7 days to 1.9 years, 1,436 surviving quotes:

| Model | Free parameters | RMSE (vol points) | Butterfly-free | Calendar-free |
|---|---|---|---|---|
| Per-slice raw SVI | 45 | **1.25** | no, 3 of 9 slices | no, 165/1928 grid cells |
| Global SSVI | 12 | 3.86 | **yes** | **yes** |

Fitting each expiry independently is 3.1× more accurate using 3.75× the parameters, and it produces a surface you cannot use. Three of the nine slices imply a negative probability density inside the quoted strike range. The fitted slices cross in total variance in the wings. Either one disqualifies the surface if you intend to differentiate it.

The trade-off is the result. Neither column is the right answer. If you're marking a book against the market, per-slice SVI plus a repair step is defensible. If anything downstream differentiates the surface, whether that's local vol, exotics or a Monte Carlo, only one of these two is admissible at all, and it costs 2.6 vol points to get there. I would rather report that number than bury it.

A few things the parameters say, which are a decent sanity check that the pipeline isn't just fitting noise. ρ lands between -0.5 and -0.8 on every slice, the strong negative skew index options are supposed to have. The SSVI fit gives γ = 0.45, so skew decays about as `T^(-0.45)`, close to the square-root decay a jump-diffusion produces and far slower than the `T^(-1)` a pure stochastic-vol model without jumps predicts. ATM vol runs 13.6% at one week to 17.7% at 1.9 years. Nothing surprising, which is the point.

Back to those 649 butterflies in the raw chain. It would be dishonest to present them as free money. The prints within a single expiry were not observed at the same instant, and a non-simultaneous price set violates convexity for purely mechanical reasons. That is the argument for imposing no-arbitrage on the fit rather than inheriting it from the data, not evidence of a trade.

## How I know it works

Live data has no ground truth. It can tell you a surface is smooth; it cannot tell you it's right. So the main validation is synthetic.

I generate a chain from a known SSVI surface (ρ = -0.72, η = 1.05, γ = 0.42), then damage it the way a real feed does, with tick rounding, spreads widening in the wings, zero bids on far strikes and stale mids on 2.5% of contracts. The entire pipeline then runs on it end to end.

| Parameter | Truth | Recovered | Error |
|---|---|---|---|
| ρ | -0.72 | -0.687 | 0.033 |
| η | 1.05 | 1.042 | 0.008 |
| γ | 0.42 | 0.430 | 0.010 |

Forwards recovered to better than 0.1% at every expiry, ATM vol to better than 0.5 points. The residual is the cost of the damage, not solver error.

The other checks: 54 contracts spanning `k ∈ [-1.5, 1.5]` and `σ ∈ [5%, 150%]` priced then inverted, with everything above 1e-6 vega round-tripping to 1e-9. The ones that don't are reported as non-invertible with a reason instead of returning a fabricated number. Accuracy in the far wing is bounded by vega rather than by the solver; the error curve and the vega curve are literally the same curve. The implied density integrates to 1 within 1e-4 on a 24,001-point grid and stays non-negative, which is the strongest single statement that a slice is clean. And a deliberately over-steepened slice produces the negative density it should, so the detector isn't just always saying yes.

92 tests, all passing.

## The interface

There's a single-file browser page in `docs/`. Open it. No server, no install, no internet, and Plotly is vendored.

The split between Python and JavaScript follows the cost of the math rather than convenience. Calibration, inversion and the arbitrage scan are expensive, so they run in Python and ship precomputed. But SVI evaluation, its k-derivatives, Durrleman's `g`, the implied density and the Black price are all closed form in the fitted parameters, so those are ported to JS and recompute live on every slider move. That's 2,501 closed-form evaluations per surface redraw. The Slice Explorer exposes the five raw SVI sliders directly, so you can break the surface yourself and watch the density go negative in real time. It explains what butterfly arbitrage actually is better than anything I could write here.

Porting the math to JS means a second implementation, which means a second chance to be wrong. `tests/test_js_parity.py` extracts the maths block out of the HTML, runs it under Node, and pins it to the Python to 1e-12.

## What I'd fix

The honest list, in rough order of how much each one bothers me.

1. **SSVI has one ρ for the entire surface.** This is the main source of the 3.86. Real skew shape changes with maturity in ways a power law in `φ` can't capture. eSSVI, with a maturity-dependent ρ, closes most of the gap and keeps the theorems.
2. **Calendar time, not business time.** `T` is ACT/365, so weekends carry full variance weight despite carrying almost none. That systematically misprices the front of the term structure. A variance clock visibly helps the front two expiries; I left it out so `T` means one unambiguous thing.
3. **The snapshot is prints, not quotes.** The free feed publishes a zero book outside regular trading hours, so all nine expiries were built from recent traded prints. Prints are worse data, since they are neither simultaneous nor necessarily at mid, and they inflate the arbitrage count. Every slice is labelled with the source it used. The 1.25 against 3.86 comparison is unaffected because both models see the same quotes, but absolute error would be lower on a live book.
4. **SPY options are American.** The ignored early-exercise premium biases deep put IVs slightly upward. SPX would remove it.
5. **The wings are extrapolation, not fit.** Beyond the quoted strikes the surface is whatever the parameterisation says. The calendar violations in the per-slice fit are concentrated around `|k| = 1.4`, well outside anything that trades, which makes them less alarming but not less real. An exotic touching those strikes prices off them.
6. **One snapshot.** Nothing here says the calibration is stable through time. A day-over-day parameter study is the obvious next diagnostic, and would probably show `m` and `σ` trading off against each other, the known SVI identifiability weakness.

Next steps I actually intend to take: eSSVI, and Dupire local volatility off the SSVI surface. The second one is the reason this project exists. With a surface that is arbitrage-free by theorem, the local variance is guaranteed positive, and you can build on it.

## Running it

```bash
pip install -r requirements.txt      # research deps only; the interface needs none
python scripts/build_frontend.py     # re-runs the pipeline, regenerates docs/data.js
pytest -q                            # 92 tests
```

`build_frontend.py` reads the committed chain snapshot in `data/`, so it is fully offline and reproducible. `--refresh` pulls a live chain instead.

For the mathematics with all the derivations, see [DEEP_DIVE.md](DEEP_DIVE.md). If the finance is new, start with [PREREQUISITES.md](PREREQUISITES.md).

## References

- Gatheral (2004), *A parsimonious arbitrage-free implied volatility parameterization*. Raw SVI.
- Gatheral and Jacquier (2014), *Arbitrage-free SVI volatility surfaces*. SSVI and the theorems everything here leans on.
- Zeliade Systems (2009), *Quasi-Explicit Calibration of Gatheral's SVI model*. The inner-linear scheme.
- Durrleman (2010), *From implied to spot volatilities*. The butterfly condition.
- Lee (2004), *The moment formula for implied volatility at extreme strikes*. The wing slope bound.
- Breeden and Litzenberger (1978), density from the second strike derivative.
- Jäckel (2015), *Let's be rational*. The structure of the branched initial guess.
- Gatheral (2006), *The Volatility Surface*, chapters 1 to 3.

MIT licensed.
