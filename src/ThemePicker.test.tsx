import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ThemePicker from "./ThemePicker";
import { themes } from "./themes";
it("offers six draft themes without applying or storing them", () => {
  const onChange = vi.fn();
  render(<ThemePicker theme="light" onChange={onChange} />);
  for (const theme of themes) {
    fireEvent.click(screen.getByRole("button", { name: theme.name }));
    expect(onChange).toHaveBeenLastCalledWith(theme.id);
  }
  expect(screen.getByRole("button", { name: themes[0].name })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
