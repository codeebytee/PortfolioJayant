---
title: "Stop Hedging Every Day, what 20000 Simulated Paths Taught Me About Transaction Costs"
date: 2026-08-04
---
# Why "Hedge More Often" Is Bad Advice, At Least Sometimes

I built an options pricing lab to answer a question that sounds simple but rarely gets a straight answer: if you're delta-hedging an option and every trade costs you money, how often should you actually rebalance?

The textbook instinct is "as often as possible." The real answer, once you put a number on transaction costs, is different. At a realistic 25 basis points per trade, the risk-adjusted best hedging frequency turned out to be roughly once every 8 trading days, not daily. Rebalancing every day at that cost level burns 1.57 in fees just to buy a risk reduction the math won't let you have much of anyway. Stretching the schedule out to 8 days improves the outcome by about 31%.

That's the headline result. Everything else in the project exists to make sure that number is trustworthy rather than just convenient.

## Why hedging frequency has a sweet spot

Hedging error doesn't shrink as fast as you'd like when you rebalance more often. It falls with the square root of the interval between trades, while your costs grow with the inverse of that same square root. Put those two curves together and you get a U-shape: rebalance too rarely and your hedge drifts away from the position, rebalance too often and fees eat the gains. Somewhere in the middle is the point where the two effects roughly cancel out.

I tested this directly rather than trusting the formula on faith. Running 20,000 simulated price paths and fitting the relationship between rebalance interval and P&L standard deviation gave a log-log slope of 0.4747, close to the theoretical 0.5 predicted by the Boyle-Emanuel square-root law. Close enough to trust the shape of the curve, not so close that I'd pretend the simulation came out perfectly.

## Four ways to price the same option

Before the hedging analysis could mean anything, the pricing itself had to be right. So the project prices European and American options four separate ways: the closed-form Black-Scholes-Merton formula, a Cox-Ross-Rubinstein binomial tree, a Crank-Nicolson finite difference solver in log-space (with Rannacher startup steps and PSOR to handle the American early-exercise constraint), and Monte Carlo simulation with antithetic and control variates for variance reduction.

All four agree to the third decimal place. That agreement is really the point of doing it four times. If an algebraic formula, a tree, a PDE solver, and a simulation all land on the same price, you have genuine confidence the number is correct rather than a bug that happens to look plausible.

The project also computes eleven Greeks, the familiar ones like delta, gamma, vega, theta and rho, plus less common second and third order ones like vanna, volga, charm, veta, speed and zomma, both analytically and through independent finite difference checks. First order Greeks match to within 1e-8. Even the third order cross derivatives, which are notoriously sensitive to numerical noise, hold to better than 3e-5.

## An interface where the sliders actually mean something

None of this is useful if it stays locked in a research notebook, so I built a browser interface with five tabs: a live Greeks lab with sliders and a rotatable 3D surface, the hedging simulator described above, a side by side comparison of all four pricing engines with convergence plots, an American exercise tab comparing tree, PSOR and least-squares Monte Carlo methods, and a validation panel with stress tests for edge cases like zero volatility or 500% volatility.

The closed-form math, Black-Scholes and its Greeks, runs live in your browser as you move the sliders. It's short enough, about fifteen lines of error function and algebra, that there was no reason to fake it. The more expensive parts, like the American exercise surface (a 41 by 25 grid of 600-step trees) and the 20,000-path hedging sweep, are precomputed and shipped as data, since running that live on every keystroke isn't realistic. Every panel is labelled with which kind it is. I didn't want to build a page where nothing computes live, and I really didn't want to build one that pretends a browser just ran a Monte Carlo simulation between mouse movements.

## Reporting the results I didn't expect

A couple of things in the validation didn't come out the way I predicted, and I kept them in rather than tuning them away.

I expected antithetic and control variates to stack when combined in the Monte Carlo pricer. They don't. The control variate alone gives a 5.76x reduction in variance, but combining it with antithetic pairing only gets 2.94x, because the control variate already removes the same payoff component that antithetic pairing targets. Using both isn't wasted, but it's more redundant than I'd assumed going in.

The Crank-Nicolson solver also came out with a convergence slope of -1.36 against a theoretical -2.0. That's a real gap, and rather than quietly picking a friendlier test range to hide it, I wrote up why I think it's a limitation of the experiment design rather than the solver itself, and left that explanation in the project's deep dive writeup for anyone who wants to check my reasoning.

## Why this matters beyond the numbers

It's easy to build a pricing tool that spits out a number. What's harder, and more useful, is building one honest enough to show where the number came from, what it assumes, and where it breaks down. The hedging result here isn't just "8 days is the answer." It's a demonstration that the common advice to hedge as frequently as possible ignores a cost structure that, once you actually measure it, changes the answer substantially.

The hedging study is a simulation on geometric Brownian motion paths, not a historical backtest, and it deliberately leaves out market impact and any borrow cost. GBM also has no jumps, so the tails in this study are a floor on real-world tail risk, not an estimate of it. None of that makes the result meaningless. It makes it a controlled experiment that isolates one specific tradeoff, rebalance frequency against transaction cost, cleanly enough to actually learn something from.

If you want to see it for yourself, the live demo runs entirely in the browser with no installation needed. Drag the transaction cost slider up to 25 basis points in the Hedging Simulator tab and watch the optimal rebalance point walk away from daily. The code, the 47 tests, and the full validation writeup are on GitHub for anyone who wants to check the work rather than take my word for it.
