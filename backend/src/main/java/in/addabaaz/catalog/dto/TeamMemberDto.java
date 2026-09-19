package in.addabaaz.catalog.dto;

import in.addabaaz.catalog.TeamMember;

public record TeamMemberDto(String name, String role, String image, String quote) {

  public static TeamMemberDto from(TeamMember member) {
    return new TeamMemberDto(
        member.getName(), member.getRole(), member.getImageUrl(), member.getQuote());
  }
}
