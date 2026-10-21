import { action } from "mobx";
import { InputRule } from "prosemirror-inputrules";
import type { EditorState } from "prosemirror-state";
import type { WidgetProps } from "@shared/editor/lib/Extension";
import {
  applyMatch,
  isTriggerMarked,
} from "@shared/editor/plugins/SuggestionsMenuPlugin";
import { isInCode } from "@shared/editor/queries/isInCode";
import Suggestion from "~/editor/extensions/Suggestion";
import TagMenu from "../components/TagMenu";

/**
 * Offers the approved tag vocabulary when `#` is typed.
 *
 * The vocabulary comes from the `tags` plugin's `/api/tags.vocabulary`
 * endpoint, which reads it from a designated document. Typing an off-list tag
 * is still possible — a CRDT editor can't reject input — but the menu is what
 * keeps a shared taxonomy from drifting in practice.
 */
export default class TagMenuExtension extends Suggestion {
  get defaultOptions() {
    return {
      trigger: "#",
      // Tags never contain spaces, and allowing them would keep the menu open
      // across an entire sentence after a stray hash.
      allowSpaces: false,
      // Makes the search term mandatory in the open regex, so a bare `#` never
      // matches. That is what stops the menu appearing while typing a markdown
      // heading, where the hash is followed by a space.
      requireSearchTerm: true,
      // `#include`, `#!/bin/sh` and CSS colours all live in code.
      enabledInCode: false,
    };
  }

  get name() {
    return "tag-menu";
  }

  /**
   * Overrides the base implementation, which only opens the menu when the whole
   * match is two characters or fewer.
   *
   * That guard exists to open a menu on the bare trigger and not re-open it
   * afterwards, which suits `:` and `@` where the search term is optional. With
   * `requireSearchTerm` the term is mandatory, so the shortest possible match
   * mid-sentence is ` #w` — three characters — and the base rule would never
   * fire anywhere except the very start of a line.
   *
   * Here the menu opens whenever the pattern matches at all, since the pattern
   * already encodes everything that makes a match valid.
   */
  inputRules = () => [
    new InputRule(
      this.openRegex,
      (
        state: EditorState,
        match: RegExpMatchArray,
        _start: number,
        end: number
      ) => {
        const { parent } = state.selection.$from;

        if (
          match &&
          (parent.type.name === "paragraph" ||
            parent.type.name === "heading") &&
          (!isInCode(state) || this.options.enabledInCode) &&
          (this.enabledInMarks ||
            !isTriggerMarked(state, end, match, this.triggerLength))
        ) {
          // Deferred for the same reason as the base implementation: the view
          // is mid DOM-read when input rules run. `applyMatch` records the
          // query and trigger position; opening is forced afterwards because
          // its own open rule is the length guard described above.
          setTimeout(
            action(() => {
              applyMatch(this.state, match, {
                triggerLength: this.triggerLength,
                cursorPos: this.editor.view.state.selection.from,
                canOpen: false,
              });
              this.state.open = true;
            }),
            0
          );
        }

        return null;
      }
    ),
  ];

  widget = ({ rtl }: WidgetProps) => (
    <TagMenu
      rtl={rtl}
      trigger={this.options.trigger}
      isActive={this.state.open}
      search={this.state.query}
      onClose={action(() => {
        this.state.open = false;
      })}
    />
  );
}
