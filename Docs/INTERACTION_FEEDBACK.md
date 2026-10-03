# Interaction feedback

This is Lantern's canonical design principle for feedback across UI and gameplay. Apply it when designing, implementing or reviewing interactions, alongside the [UI design system](UI_DESIGN.md), [art direction](ART_DIRECTION.md#design-principles), [runtime conventions](RUNTIME.md#prototype-conventions) and [gameplay sound](AUDIO.md).

## Core principle

**Every meaningful player action must produce a timely, perceptible, truthful response.** Players should understand that their input registered and whether the action succeeded, is pending, was blocked, or was cancelled. Feedback may be visual and/or audible; essential outcomes must remain understandable without sound.

Meaningful actions include menu activation, navigation, item manipulation, movement, abilities and world interactions, including unsuccessful attempts. This does not require a separate cue for arbitrary unbound keys, every raw pointer event or every held-key repeat. Existing character movement, animation, focus, item placement or another clear state change can already provide the response.

This is a requirement for future interaction work, not a claim that all existing interactions comply. Introducing the principle does not authorize a whole-game audit or unrelated changes.

## Practical guidance

- **Acknowledge promptly.** Show a press, focus change, action start or other appropriate response when input is accepted. Input handling must not wait for decorative animation. For delayed work, distinguish pending from completion and keep the affected action/context identifiable.
- **Tell the truth.** Show success only after the gameplay or settings owner commits it. An accepted attack is not a confirmed hit; an equipment preparation is not an equipped item. Communicate the eventual outcome separately when needed. Feedback must follow real state and event timing, not manufacture results through animation timers.
- **Explain blocked attempts.** Make cooldown, missing resources, occupied destinations or other relevant constraints understandable near the action. A clear existing indicator can suffice; add a brief local reason when the result would otherwise be ambiguous. Preserve items and interaction context on failure, and communicate how the player can recover when needed.
- **Make cancellation legible.** Clearly end a carry, selection, cast or pending interaction when cancellation is allowed. Restore the correct visible state without implying success or losing player data.
- **Match importance and frequency.** Keep routine cues restrained and consistent; reserve stronger emphasis for consequential outcomes. Continuous movement can be continuous feedback. Aggregate or suppress repeated cues while retaining an understandable state; do not play an error sound for every held-key repeat. Keep combat, useful information and world readability primary.
- **Keep essential meaning available.** Players must understand essential outcomes with sound muted or unavailable and with reduced motion enabled. Use static state changes, shapes, icons or concise text when necessary; color alone is insufficient. Sound can reinforce visible results without becoming mandatory to understand them. Honor existing sound preferences and motion guidance.
- **Design at gameplay scale.** Judge visibility, timing, location and audible clarity in the actual interaction. Prefer the natural result over extra particles, screen motion, glow or status copy. Reuse existing presentation and audio owners; this principle does not require a new feedback system or alter gameplay clocks.

The [UI motion and sound rules](UI_DESIGN.md#motion-and-sound) and [audio event timing](AUDIO.md#owners-and-event-timing) remain authoritative for their specialized behavior.

## Lantern examples

These are design expectations, not a report of current implementation coverage.

| Interaction | Appropriate response |
| --- | --- |
| Open a menu, activate a tab or adjust a setting | The menu appears, the active tab changes or the actual value updates; show press/focus acknowledgment where needed. Restrained sound may reinforce the change. |
| Move, equip or transfer an item | Show carrying and valid/invalid destinations; show the committed item position or equipment only after success. If placement or exchange is blocked, retain the item and make the reason clear locally. |
| Move or use an ability | Collision-resolved movement and action animation acknowledge execution. Distinguish windup/release from hit results; make blocked readiness or resource requirements understandable. Walking against a wall does not require fabricated movement or footstep sounds. |
| Gather wood or ore | Show the accepted gathering action and its actual progress/contact. Reflect depletion and awarded resources when they occur; make an unavailable or interrupted attempt understandable. |
| Travel | Acknowledge the request and any preparation wait, then show arrival after the destination commits. On failure, retain the current area and give an actionable local explanation. |
| Cancel an item carry or close a menu | Remove the transient carry or close the sheet and restore the appropriate item/focus state. A cancellation must not look like a completed transfer. |

## Why this matters

**Understanding, control and trust.** Feedback helps people evaluate whether an action registered and what to do next. Visible progress reduces uncertainty and unnecessary repeated activation while a process is working. Immediate responses also help people associate errors with the action that caused them. See Aurora Harley's [Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/) (Nielsen Norman Group, 2018).

**Game feel and learning the rules.** Coordinated visual and audio responses connect input to action and communicate game state. Hicks, Dickinson, Holopainen and Gerling's [Good Game Feel: An Empirically Grounded Framework for Juicy Design](https://dl.digra.org/index.php/dl/article/view/936) (2018) develops a framework from 17 developer survey responses and analysis of two games. It emphasizes a coherent approach to feedback rather than simply adding effects. This is a design framework, not proof that stronger effects always improve player experience; the paper also discusses prior null findings. Lantern's application is to make cause, state and outcome clear while preserving restraint.

**Audio can strengthen presence.** Smets and van der Spek's [That Sound’s Juicy! Exploring Juicy Audio Effects in Video Games](https://research.tue.nl/en/publications/that-sounds-juicy-exploring-juicy-audio-effects-in-video-games/) (2021) compared two versions of a game with and without embellished audio. Participants reported greater presence, including immersion and sensory fidelity, in the embellished-audio condition. This supports considering sound as part of interaction design; it does not establish that every action needs a sound or that louder/more frequent cues are better.

**Accessibility and everyday conditions.** Essential sound-only information excludes people with hearing loss and can be missed in noisy environments or muted play. [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/ensure-no-essential-information-is-conveyed-by-sounds-alone/) recommends conveying essential information through another means and checking whether a first-time player can progress with sound muted. Lantern therefore requires visible essential outcomes and uses sound as reinforcement where useful.

## Review during interaction work

For the interaction being changed, identify the input, acknowledgment and real outcome, including relevant pending, blocked and cancellation states. In the normal focused interaction review, verify that the player can tell what happened at gameplay scale, essential meaning survives muted sound, and reduced motion retains necessary state information. Confirm that feedback does not delay controls, imply an uncommitted result or overwhelm repeated actions.

Follow the existing [daily validation workflow](DEVELOPMENT.md#commands-and-handoff). This principle adds no default automated tests, performance measurements, full local suite or whole-game checklist. Documentation-only changes need links and diff review; they do not establish visual quality or current interaction compliance.
