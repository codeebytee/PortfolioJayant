---
title: " What a 9 percent coupon is actually worth"
date: 2026-08-20
---
# what-a-9-percent-coupon-is-actually-worth

A retail structured note fits on one page. Three years, quarterly observations, autocall at 100% of the starting level, a 9% annual memory coupon paid whenever the index is above 75%, capital back in full unless the index finishes below 70%. It reads like a bond with a good coupon, and that is why it sells.

It isn't a bond. It is a zero-coupon bond, a strip of digital coupon options, an autocall trigger and a short deep out-of-the-money put, wrapped together and sold as income. I wanted to know what the coupon on that package is actually worth, so I built the engine that prices it and then spent most of the project measuring how wrong the standard implementations are.

The short version: at SPY's own at-the-money implied vol on the 2026-08-07 snapshot (18.9%, spot 773.26), the note fairly supports a **7.19%** coupon. Priced at the printed 9%, it is worth 101.85 per 100 with a 95% Monte Carlo interval of ±0.02. Two modelling shortcuts that almost every teaching implementation makes move the answer by more than the entire bid-offer on the contract.

## What the thing does

`src/` is a path-dependent pricing library. `docs/index.html` is a single file you double-click, with no server, no install and no network, that runs the whole Monte Carlo in the browser and resolves the term sheet live while you drag sliders.

The engine prices Asian, lookback, barrier, digital and cliquet contracts, and the autocallable note with all its real features: memory coupons, a lockout before the first call date, European or American soft protection, and a participation rate on the downside. Every number comes back with a confidence interval rather than as a bare price, which turns out to matter more than it sounds like it should.

The design rests on one algebraic observation. The autocall time and the coupon indicators are functions of the path only. Neither depends on the coupon rate. So the present value is exactly affine in the coupon,

```
PV(c) = PV_0 + c * A
```

where `A` is the risk-neutral coupon annuity, the expected discounted number of coupon units the note pays. Not approximately affine, not locally affine. Exactly. Which means the fair coupon is a division,

```
c* = (N - PV_0) / A
```

and both terms come out of a single simulation. No root search, no repricing loop. That is why a browser can re-solve the term sheet on a slider drag at 12,000 paths and still feel instant. Because it is a claim rather than a fact, I tested it against a Brent search that genuinely reprices the note to par: the two agree to 1.4e-17, which is machine precision, because they are algebraically the same quantity.

## The number that actually matters

Fair coupon 7.19% against a printed 9%. It would be dishonest to call that a 181 bp mispricing, and I want to be careful here. The 7.19% is the derivative-only value. The gap pays the issuer's credit spread, its hedging costs and its margin, and the skew correction below eats into it from the other side. The honest statement is that the printed coupon is plausible, and that the investor is being paid, in large part, for writing a put and for lending money unsecured to a bank. The term sheet says neither of those things in those words.

The distribution is the more interesting half of the output anyway:

| | |
|---|---|
| Expected life | 1.20 years against a stated 3 |
| P(autocall at the first eligible date, six months in) | 51.9% |
| P(held to maturity) | 18.5% |
| P(loss) | 7.4% |
| E[loss given loss] | 40.8 points of notional |

Read that as an analyst rather than a coder. The modal outcome is roughly a 4% return in six months. The mean is dragged down by a thin, deep left tail. The payoff distribution is bimodal and badly asymmetric, so any risk report quoting the mean return, or the probability of a positive return, is describing exactly the wrong half of it. There is also a reinvestment problem baked into the structure: the note hands your money back early in precisely the rallying states where reinvesting is least attractive, and stays alive to maturity in the falling states where the short put bites.

## Two shortcuts that cost more than the bid-offer

This is the part I care about most, because both mistakes are invisible. Neither produces a crash, a NaN, or a number that looks wrong.

**Discrete monitoring dressed up as continuous.** The obvious way to price a barrier is to step the path daily and check an indicator at each node. That prices a *daily-monitored* contract, not a continuous one. For a one-year down-and-out call with a barrier at 90% of spot: the continuous value is 58.20, daily stepping gives 59.86, and quarterly monitoring gives 66.18. Daily stepping is 285 bp high on a contract whose bid-offer is a couple of basis points. That error does not shrink with more paths. It is bias, not noise.

The fix is to weight rather than sample. Conditional on the log endpoints of a step, the segment between them is a Brownian bridge, and the probability that it touched the barrier has a closed form. Each path then carries a survival weight, the product of `(1 - p_i)`, instead of a 0/1 flag. The usual reason given for this is that it removes the discretisation bias. The reason people mention less often is that it is also the conditional expectation of the indicator given the simulated skeleton, so by Rao-Blackwell it has strictly lower variance too. Bias and variance both improve. There is no tradeoff to make here, which is rare enough to be worth saying out loud.

**Flat volatility.** The note is short a 70%-strike down-and-in put on an index, which is about the most skew-sensitive instrument you can hold. Pricing it with a single lognormal vol is wrong, and it is wrong in a direction that flatters the issuer. I measured it with a CEV arm at matched at-the-money vol: introducing a downside skew (`β = 0.2`) raises the fair coupon from 7.24% to 8.00% at 19% vol, so 76 bp, widening to 92 bp at 26% vol. Flat GBM makes the note look cheaper to issue than it is, systematically.

A third one, smaller but the same shape: switching the same note from a European knock-in (checked once, at maturity) to an American one (checked daily) costs the investor 105 bp of coupon and doubles the knock-in probability from 6.6% to 13.0%. The gap peaks near 22% vol and shrinks at both ends, since at low vol nothing reaches the barrier under either convention and at high vol most paths that touch it finish below anyway. The convention matters most exactly where the barrier is a live question, which is where retail notes get struck.

Three effects, all in the tens to hundreds of basis points, all larger than the trading cost of the contract, and none of them visible on the term sheet.

## Obstacles, or the things that quietly went wrong

Some of these cost real time, and none of them announce themselves.

**Quasi-Monte Carlo that mysteriously underperforms.** Sobol sequences equidistribute their leading dimensions far better than their later ones. A 756-step daily path is formally a 756-dimensional integral, and if you build it stepwise, QMC on a path-dependent payoff is close to pointless. Building by Brownian bridge instead (draw the endpoint from the first dimension, then the midpoint, then the quarter points) concentrates the path's variance in the leading coordinates and drops the effective dimension to around 10. Related trap, same cause: the lookback's bridge extremum needs a uniform per step, and those must come from a separate pseudo-random stream. They are pure nuisance dimensions with no low-dimensional structure, and spending scarce well-equidistributed Sobol coordinates on them degrades the ones carrying the path. That never shows up as a bug. It shows up as your fancy sampler being no better than the naive one, with no error message to tell you why.

**A sampler with no error bars.** Raw Sobol is a deterministic quadrature rule. The sample standard deviation of its points is not a standard error, so a plain Sobol run gives you a price with no honest interval at all. Owen scrambling fixes this by randomising the points while preserving equidistribution, so each scramble is an unbiased estimator and 16 of them give you 16 independent observations and a Student-t interval. Everything in the repo runs 16 scrambles of 4,096 points for that reason.

**Applying a correction where it doesn't belong.** The continuity correction is for continuous monitoring, and reusing it across a weekly observation schedule to price a weekly-monitored note is exactly wrong. Bridging between observation dates asks whether the path touched at any instant in between, which is a different contract. A discretely monitored note is priced by looking at its observation dates and nothing else.

**Degenerate inputs from a UI.** The moment you put sliders on a pricer, users reach zero vol, zero maturity, a barrier sitting exactly on spot, and inverted barriers. The bridge exponent is `-inf/0` at zero variance, and the page renders NaN. Floating point also produces crossing probabilities marginally above 1 when a path sits within machine epsilon of the barrier. Both needed guards, and the interface now has a stress panel that reaches all of those states deliberately and shows a readable warning banner instead of a blank chart.

**Two implementations of the same maths.** Porting the pricer to JavaScript means a second chance to be wrong. So `scripts/check_page.py` drives the page headless from `file://`, exercises every control, tab and preset, checks that no console error fires, and cross-checks the page's closed forms against the Python library. Worst relative gap over 55 values: 1.1e-15. The browser's own 12,000-path run of the base note agrees with the Python 65,536-path run within 0.8 standard errors on the European knock-in and 2.2 on the American, and the page reports that in its validation tab rather than hiding it.

## How I know it works

Live prices have no ground truth, so validation has to come from theory.

Nine exotic contracts priced against nine closed forms: Kemna-Vorst geometric Asian, Reiner-Rubinstein barriers in all four flavours, Goldman-Sosin-Gatto floating lookbacks both ways, a cash-or-nothing digital, and the autocallable itself with the autocall and coupons stripped, which reduces to a zero-coupon bond short a European put spread. All nine sit inside their 95% interval, worst discrepancy 1.59 standard errors.

The convergence study is the part I found most instructive, because it contradicts the folklore. Sobol's celebrated `O(N^-1)` rate shows up only on the one-dimensional digital payoff, where it gives a 1263x RMSE improvement at 2^16 paths and a fitted log-log slope of -1.31. It shows up there despite that payoff being discontinuous, which is the opposite of what the smoothness argument predicts. On the twelve-dimensional autocallable the fitted slope is -0.59 against -0.50 for pseudo-random. That is a 3.1x constant-factor win, which is worth having, but it is not a better rate. Effective dimension governs this, not smoothness.

The continuity correction gets checked two independent ways: the bridge-corrected simulation matches the Reiner-Rubinstein continuous closed form to 2.8 bp, and separately the Broadie-Glasserman-Kou shifted-barrier approximation reproduces the simulated discrete prices across seven monitoring frequencies to within a few basis points. Two different pieces of theory agreeing with the same simulation says more than either one alone.

Plus 90 pytest tests covering put-call parity, in-out parity, the zero-vol and zero-time limits, memory-coupon accounting, and the monotonicity the fair coupon has to satisfy in each barrier.

## What this is good for beyond the note

The applications generalise past autocallables, which is why the affine result is the piece I would keep.

Any contract whose cashflow schedule is path-determined but whose *rate* is a free parameter has the same structure, and its fair rate is a division rather than a search. That covers coupon solving on a range accrual, a participation rate on a growth note, and in general any structuring exercise where you have to hit par by construction. One simulation, closed-form solve, and the whole thing runs at interactive speed.

The bridge survival weight generalises to anything with a knock-out or knock-in feature, which is most of the barrier book. The measured cost of getting it wrong, 285 bp on a plain daily-stepped implementation, is a decent argument for auditing whatever a desk's existing implementation actually does before trusting a barrier mark.

And the shape of the risk result matters for anyone reporting on these products. Expected life of 1.20 years against a stated three is the fact that a client of a note like this most needs, and it isn't on the term sheet. Neither is the 7.4% chance of losing an average of 40.8 points.

## What it can't do

The honest list, roughly in order of how much each bothers me.

1. **One underlying.** Real retail autocallables are usually worst-of on three or four names, where correlation skew dominates every effect measured here. This engine does not price them.
2. **Flat vol.** The CEV arm measures the error, it does not fix it. A production version calibrates a local or stochastic vol surface. In production you would notice this as systematically wrong hedge ratios against listed downside puts and a persistent unexplained skew term in the P&L attribution.
3. **No credit and no funding.** A note is an unsecured claim on the issuer. This is the single largest gap between the number here and the number a client pays.
4. **CEV is Euler-discretised**, so unlike the GBM arm it carries a discretisation bias on top of the Monte Carlo error. It is used for a difference at matched ATM vol, where that bias largely cancels, so the absolute CEV levels deserve less trust than the absolute GBM ones.
5. **Deterministic rates.** A three-year note on an index survives this. A ten-year note does not, and the autocall feature is itself rate-sensitive through the discount factors on the annuity.
6. **Hedging cost is unmodelled.** Gamma near the autocall barrier at an observation date is unbounded in the continuous-monitoring limit. A realistic issuer margin includes a charge for that and this price does not.
7. **One snapshot.** Every number is as of 2026-08-07, labelled as such on the page. Re-run `scripts/refresh_market.py` and every figure moves.

## Next

Worst-of on a basket, with a correlation-skew sensitivity study that mirrors what the CEV arm does for volatility skew here, is the extension that would make this price the product people actually buy.

After that, feeding local-volatility dynamics from the Dupire surface of the previous project in this series, so the 76 bp skew number becomes a price rather than a sensitivity. Then Greeks by pathwise or adjoint differentiation instead of bump-and-revalue, which is a genuinely interesting problem here because the autocall indicator is discontinuous and needs either smoothing or a likelihood-ratio estimator. An issuer funding curve would let the printed coupon be decomposed explicitly into option premium, credit spread and margin, which is the decomposition a buyer would most want to see. And a hedging simulator measuring realised cost against the theoretical price would fill in limitation 6.

## Running it

```bash
pip install -r requirements.txt
python scripts/make_results.py       # the full study, about 2.5 min, writes results/
python scripts/build_frontend.py     # regenerates docs/data.js from src/
pytest -q                            # 90 tests
```

The interface needs none of that. Clone the repo, double-click `docs/index.html`, and it runs offline from the committed snapshot with Plotly vendored.

For the derivations, the validation tables and the full limitations section, see [DEEP_DIVE.md](DEEP_DIVE.md). If the finance is new, [PREREQUISITES.md](PREREQUISITES.md) is written for an engineer and defines every symbol.

Nothing here forecasts a market. Every output is a price, a probability or a risk measure under the risk-neutral measure.

## References

- Broadie, Glasserman and Kou (1997), *A Continuity Correction for Discrete Barrier Options*. The shifted-barrier approximation used as the second check.
- Glasserman (2003), *Monte Carlo Methods in Financial Engineering*. Chapters 5, 6.4 and 7.
- Owen (1997), *Scrambled Net Variance for Integrals of Smooth Functions*. Why the prices here have error bars at all.
- Caflisch, Morokoff and Owen (1997), *Valuation of Mortgage-Backed Securities Using Brownian Bridges to Reduce Effective Dimension*. The effective-dimension argument.
- Kemna and Vorst (1990), geometric Asian closed form.
- Goldman, Sosin and Gatto (1979), floating lookbacks.
- Reiner and Rubinstein (1991), *Breaking Down the Barriers*.
- Bouzoubaa and Osseiran (2010), *Exotic Options and Hybrids*, chapters 12 to 14 on autocallables.
- Cox (1975), the CEV diffusion.

MIT licensed.
