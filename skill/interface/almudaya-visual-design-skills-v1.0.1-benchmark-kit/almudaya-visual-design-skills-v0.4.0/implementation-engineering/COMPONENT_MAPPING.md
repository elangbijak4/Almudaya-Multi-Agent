# Native Component Mapping Guide

This guide provides decision patterns, not mandatory one-to-one mappings.

| Intent | Web | iOS | Android | Desktop | TV / Remote |
|---|---|---|---|---|---|
| Primary navigation | semantic nav, links | tab/navigation patterns | NavigationBar/Drawer/Rail as appropriate | menu, sidebar, tabs | focusable rail or rows |
| Command/action | button | Button | Button | Button/menu command | focusable action |
| Selection | select/radio/checkbox | Picker/selection controls | exposed dropdown/radio/chips | native selection control | focusable list/grid |
| Modal decision | dialog | alert/sheet | dialog/bottom sheet | dialog/sheet | simple focus-managed dialog |
| Long content | scroll region | ScrollView/List | LazyColumn/LazyGrid | scroll view/virtualized list | focus-aware scrolling |
| Data entry | labeled input | TextField/Form | TextField/Form | native text field | minimize text entry; provide alternatives |
| Context menu | menu | context menu | contextual menu | native menu | avoid pointer-only context menus |

## Selection rules

- Match user intent and platform convention, not component appearance alone.
- Keep labels persistent for critical inputs.
- Preserve focus order and focus restoration after dialogs.
- Ensure every custom component exposes an accessible name, role, value, and state.
- On TV and remote-driven devices, make focus location obvious.
- For automotive and industrial control, prioritize safety, error prevention, and operational clarity over visual novelty.
